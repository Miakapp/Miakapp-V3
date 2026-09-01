import { apiError } from './errors.js';
import { IDENTIFIER_PATTERN, SHA256_PATTERN } from './types.js';
import { MAX_COMPONENT_ARTIFACT_BYTES } from './component-artifact.js';

const EMULATOR_PROJECT = 'demo-miakapp-v4';
const JAVASCRIPT_CONTENT_TYPE = 'application/javascript; charset=utf-8';

interface StoredObjectMetadata {
  readonly size?: string | number;
  readonly contentType?: string;
  readonly cacheControl?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

interface ExpectedObjectMetadata {
  readonly cacheControl: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ComponentStorageFile {
  save(data: Uint8Array, options: {
    readonly resumable: false;
    readonly validation: 'crc32c';
    readonly preconditionOpts: { readonly ifGenerationMatch: 0 };
    readonly metadata: {
      readonly contentType: typeof JAVASCRIPT_CONTENT_TYPE;
      readonly cacheControl: string;
      readonly metadata: Readonly<Record<string, string>>;
    };
  }): Promise<unknown>;
  exists(): Promise<readonly [boolean, ...unknown[]]>;
  getMetadata(): Promise<readonly [StoredObjectMetadata, ...unknown[]]>;
  download(): Promise<readonly [Buffer, ...unknown[]]>;
}

export interface ComponentStorageBucket {
  readonly name: string;
  file(name: string): ComponentStorageFile;
}

export interface EmulatorComponentStorageConfig {
  readonly projectId: string;
  readonly functionsEmulator: boolean;
  readonly storageEmulatorHost: string | undefined;
  readonly bucketName: string;
}

export interface ComponentObjectStorage {
  writeStaging(uploadId: string, bytes: Uint8Array): Promise<void>;
  readStaging(uploadId: string): Promise<Uint8Array | null>;
  writeArtifact(sha256: string, bytes: Uint8Array): Promise<void>;
  readArtifact(sha256: string): Promise<Uint8Array | null>;
}

function objectAbsent(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 404 || error.code === '404');
}

function preconditionFailed(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 409 || error.code === 412 || error.code === '409' || error.code === '412');
}

function exactStoredSize(metadata: StoredObjectMetadata): number {
  const size = typeof metadata.size === 'string' ? Number(metadata.size) : metadata.size;
  if (!Number.isSafeInteger(size) || (size as number) <= 0) throw apiError('invalid_artifact');
  if ((size as number) > MAX_COMPONENT_ARTIFACT_BYTES) throw apiError('limit_exceeded');
  return size as number;
}

function validateStoredMetadata(
  actual: StoredObjectMetadata,
  expected: ExpectedObjectMetadata,
): void {
  const custom = actual.metadata;
  if (actual.contentType !== JAVASCRIPT_CONTENT_TYPE
    || actual.cacheControl !== expected.cacheControl
    || custom === undefined
    || Object.keys(custom).length !== Object.keys(expected.metadata).length
    || Object.entries(expected.metadata).some(([key, value]) => custom[key] !== value)) {
    throw apiError('invalid_artifact');
  }
}

export class FirebaseComponentStorage implements ComponentObjectStorage {
  readonly #bucket: ComponentStorageBucket;

  constructor(bucket: ComponentStorageBucket, config: EmulatorComponentStorageConfig) {
    if (config.projectId !== EMULATOR_PROJECT
      || !config.functionsEmulator
      || typeof config.storageEmulatorHost !== 'string'
      || config.storageEmulatorHost.trim().length === 0
      || config.bucketName !== bucket.name
      || config.bucketName !== `${EMULATOR_PROJECT}.appspot.com`) {
      throw new Error('Component storage is restricted to the demo Firebase Emulator project');
    }
    this.#bucket = bucket;
  }

  async writeStaging(uploadId: string, bytes: Uint8Array): Promise<void> {
    if (!IDENTIFIER_PATTERN.test(uploadId)
      || bytes.byteLength === 0
      || bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES) {
      throw apiError(bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES ? 'limit_exceeded' : 'invalid_artifact');
    }
    const file = this.#bucket.file(this.#stagingPath(uploadId));
    try {
      await file.save(bytes, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: JAVASCRIPT_CONTENT_TYPE,
          cacheControl: 'no-store',
          metadata: {
            schema: 'miakapp.component-staging-object/1',
            upload_id: uploadId,
          },
        },
      });
    } catch (error) {
      if (!preconditionFailed(error)) throw apiError('temporarily_unavailable');
      const existing = await this.#read(file, {
        cacheControl: 'no-store',
        metadata: {
          schema: 'miakapp.component-staging-object/1',
          upload_id: uploadId,
        },
      });
      if (existing === null || !Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw apiError('invalid_upload_capability');
      }
    }
  }

  readStaging(uploadId: string): Promise<Uint8Array | null> {
    if (!IDENTIFIER_PATTERN.test(uploadId)) throw apiError('invalid_artifact');
    return this.#read(this.#bucket.file(this.#stagingPath(uploadId)), {
      cacheControl: 'no-store',
      metadata: {
        schema: 'miakapp.component-staging-object/1',
        upload_id: uploadId,
      },
    });
  }

  async writeArtifact(sha256: string, bytes: Uint8Array): Promise<void> {
    if (!SHA256_PATTERN.test(sha256)
      || bytes.byteLength === 0
      || bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES) {
      throw apiError('invalid_artifact');
    }
    const file = this.#bucket.file(this.#publicPath(sha256));
    try {
      await file.save(bytes, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: JAVASCRIPT_CONTENT_TYPE,
          cacheControl: 'private, no-store',
          metadata: {
            schema: 'miakapp.component-artifact/1',
            sha256,
          },
        },
      });
    } catch (error) {
      if (!preconditionFailed(error)) throw apiError('temporarily_unavailable');
      const existing = await this.#read(file, {
        cacheControl: 'private, no-store',
        metadata: {
          schema: 'miakapp.component-artifact/1',
          sha256,
        },
      });
      if (existing === null || !Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw apiError('invalid_artifact');
      }
    }
  }

  readArtifact(sha256: string): Promise<Uint8Array | null> {
    if (!SHA256_PATTERN.test(sha256)) throw apiError('invalid_artifact');
    return this.#read(this.#bucket.file(this.#publicPath(sha256)), {
      cacheControl: 'private, no-store',
      metadata: {
        schema: 'miakapp.component-artifact/1',
        sha256,
      },
    });
  }

  async #read(
    file: ComponentStorageFile,
    expectedMetadata: ExpectedObjectMetadata,
  ): Promise<Uint8Array | null> {
    try {
      const [exists] = await file.exists();
      if (!exists) return null;
      const [metadata] = await file.getMetadata();
      const expectedSize = exactStoredSize(metadata);
      validateStoredMetadata(metadata, expectedMetadata);
      const [bytes] = await file.download();
      if (bytes.byteLength !== expectedSize || bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES) {
        throw apiError('invalid_artifact');
      }
      return new Uint8Array(bytes);
    } catch (error) {
      if (objectAbsent(error)) return null;
      if (error instanceof Error && 'code' in error) throw error;
      throw apiError('temporarily_unavailable');
    }
  }

  #stagingPath(uploadId: string): string {
    return `component-staging/${uploadId}.js`;
  }

  #publicPath(sha256: string): string {
    return `components/${sha256}.js`;
  }
}
