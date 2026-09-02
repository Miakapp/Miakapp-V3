import { describe, expect, test } from 'bun:test';

import {
  FirebaseComponentStorage,
  ProductionFirebaseComponentStorage,
  type ComponentStorageBucket,
  type ComponentStorageFile,
  type EmulatorComponentStorageConfig,
  type ProductionComponentStorageConfig,
} from '../../src/component-storage.js';

interface SavedObject {
  bytes: Buffer;
  options: Parameters<ComponentStorageFile['save']>[1];
  metadataOverride?: {
    readonly size?: string | number;
    readonly contentType?: string;
    readonly cacheControl?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  };
}

class MemoryFile implements ComponentStorageFile {
  readonly #name: string;
  readonly #objects: Map<string, SavedObject>;

  constructor(name: string, objects: Map<string, SavedObject>) {
    this.#name = name;
    this.#objects = objects;
  }

  save(bytes: Uint8Array, options: Parameters<ComponentStorageFile['save']>[1]): Promise<void> {
    if (this.#objects.has(this.#name)) return Promise.reject(Object.assign(new Error('exists'), { code: 412 }));
    this.#objects.set(this.#name, { bytes: Buffer.from(bytes), options });
    return Promise.resolve();
  }

  exists(): Promise<readonly [boolean]> {
    return Promise.resolve([this.#objects.has(this.#name)] as const);
  }

  getMetadata(): Promise<readonly [{
    readonly size?: string | number;
    readonly contentType?: string;
    readonly cacheControl?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }]> {
    const object = this.#objects.get(this.#name);
    if (object === undefined) return Promise.reject(Object.assign(new Error('missing'), { code: 404 }));
    return Promise.resolve([object.metadataOverride ?? {
      size: object.bytes.byteLength,
      contentType: object.options.metadata.contentType,
      cacheControl: object.options.metadata.cacheControl,
      metadata: object.options.metadata.metadata,
    }] as const);
  }

  download(): Promise<readonly [Buffer]> {
    const object = this.#objects.get(this.#name);
    if (object === undefined) return Promise.reject(Object.assign(new Error('missing'), { code: 404 }));
    return Promise.resolve([Buffer.from(object.bytes)] as const);
  }
}

function memoryBucket(name = 'demo-miakapp-v4.appspot.com'): {
  readonly bucket: ComponentStorageBucket;
  readonly objects: Map<string, SavedObject>;
  readonly fileCalls: () => number;
} {
  const objects = new Map<string, SavedObject>();
  let calls = 0;
  return {
    bucket: {
      name,
      file(name: string) {
        calls += 1;
        return new MemoryFile(name, objects);
      },
    },
    objects,
    fileCalls: () => calls,
  };
}

const CONFIG: EmulatorComponentStorageConfig = Object.freeze({
  projectId: 'demo-miakapp-v4',
  functionsEmulator: true,
  storageEmulatorHost: '127.0.0.1:9199',
  bucketName: 'demo-miakapp-v4.appspot.com',
});
const UPLOAD_ID = Buffer.alloc(16, 1).toString('base64url');
const DIGEST = Buffer.alloc(32, 2).toString('base64url');

describe('FirebaseComponentStorage', () => {
  test('rejects non-demo boundaries before touching a bucket', () => {
    for (const config of [
      { ...CONFIG, projectId: 'production-project' },
      { ...CONFIG, functionsEmulator: false },
      { ...CONFIG, storageEmulatorHost: undefined },
      { ...CONFIG, bucketName: 'other.appspot.com' },
    ]) {
      const memory = memoryBucket();
      expect(() => new FirebaseComponentStorage(memory.bucket, config))
        .toThrow(/restricted|base URL/);
      expect(memory.fileCalls()).toBe(0);
    }
  });

  test('writes one private create-only staging object and reads back exact bytes', async () => {
    const memory = memoryBucket();
    const storage = new FirebaseComponentStorage(memory.bucket, CONFIG);
    const bytes = Buffer.from('self.answer = 42;\n');
    await storage.writeStaging(UPLOAD_ID, bytes);

    expect(memory.objects.get(`component-staging/${UPLOAD_ID}.js`)).toEqual({
      bytes,
      options: {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/javascript; charset=utf-8',
          cacheControl: 'no-store',
          metadata: {
            schema: 'miakapp.component-staging-object/1',
            upload_id: UPLOAD_ID,
          },
        },
      },
    });
    expect(await storage.readStaging(UPLOAD_ID)).toEqual(new Uint8Array(bytes));
  });

  test('reconciles an ambiguous repeated write only when bytes are identical', async () => {
    const storage = new FirebaseComponentStorage(memoryBucket().bucket, CONFIG);
    const bytes = Buffer.from('self.answer = 42;\n');
    await storage.writeStaging(UPLOAD_ID, bytes);
    await expect(storage.writeStaging(UPLOAD_ID, bytes)).resolves.toBeUndefined();
    await expect(storage.writeStaging(UPLOAD_ID, Buffer.from('self.answer = 43;\n')))
      .rejects.toMatchObject({ code: 'invalid_upload_capability' });
  });

  test('writes one immutable private artifact and rejects conflicting bytes or metadata', async () => {
    const memory = memoryBucket();
    const storage = new FirebaseComponentStorage(memory.bucket, CONFIG);
    const bytes = Buffer.from('self.answer = 42;\n');
    await storage.writeArtifact(DIGEST, bytes);
    await expect(storage.writeArtifact(DIGEST, bytes)).resolves.toBeUndefined();
    await expect(storage.writeArtifact(DIGEST, Buffer.from('self.answer = 43;\n')))
      .rejects.toMatchObject({ code: 'invalid_artifact' });
    expect(await storage.readArtifact(DIGEST)).toEqual(new Uint8Array(bytes));

    const path = `components/${DIGEST}.js`;
    const object = memory.objects.get(path);
    if (object === undefined) throw new Error('Published object missing');
    expect(object).toEqual({
      bytes,
      options: {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/javascript; charset=utf-8',
          cacheControl: 'private, no-store',
          metadata: {
            schema: 'miakapp.component-artifact/1',
            sha256: DIGEST,
          },
        },
      },
    });
    for (const metadataOverride of [
      {
        size: bytes.byteLength,
        contentType: 'text/html',
        cacheControl: 'private, no-store',
        metadata: { schema: 'miakapp.component-artifact/1', sha256: DIGEST },
      },
      {
        size: bytes.byteLength,
        contentType: 'application/javascript; charset=utf-8',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { schema: 'miakapp.component-artifact/1', sha256: DIGEST },
      },
      {
        size: bytes.byteLength,
        contentType: 'application/javascript; charset=utf-8',
        cacheControl: 'private, no-store',
        metadata: { schema: 'miakapp.component-artifact/1', sha256: Buffer.alloc(32, 3).toString('base64url') },
      },
    ]) {
      memory.objects.set(path, { ...object, metadataOverride });
      await expect(storage.writeArtifact(DIGEST, bytes))
        .rejects.toMatchObject({ code: 'invalid_artifact' });
    }
  });
});

describe('ProductionFirebaseComponentStorage', () => {
  const productionConfig: ProductionComponentStorageConfig = Object.freeze({
    environment: 'staging',
    projectId: 'miakapp-v4-staging',
    functionsEmulator: false,
    storageEmulatorHost: undefined,
    bucketName: 'miakapp-v4-staging-components',
  });

  test('binds the exact environment, project, and private bucket before touching Storage', () => {
    for (const candidate of [
      { ...productionConfig, projectId: 'miakapp-v4' },
      { ...productionConfig, functionsEmulator: true },
      { ...productionConfig, storageEmulatorHost: '127.0.0.1:9199' },
      { ...productionConfig, bucketName: 'other-bucket' },
    ]) {
      const memory = memoryBucket('miakapp-v4-staging-components');
      expect(() => new ProductionFirebaseComponentStorage(memory.bucket, candidate))
        .toThrow(/configuration is invalid/);
      expect(memory.fileCalls()).toBe(0);
    }
  });

  test('uses the same create-only and exact read-back contract in staging', async () => {
    const memory = memoryBucket('miakapp-v4-staging-components');
    const storage = new ProductionFirebaseComponentStorage(memory.bucket, productionConfig);
    const bytes = Buffer.from('self.answer = 42;\n');

    await storage.writeStaging(UPLOAD_ID, bytes);
    await storage.writeArtifact(DIGEST, bytes);

    expect(await storage.readStaging(UPLOAD_ID)).toEqual(new Uint8Array(bytes));
    expect(await storage.readArtifact(DIGEST)).toEqual(new Uint8Array(bytes));
    expect(memory.objects.get(`component-staging/${UPLOAD_ID}.js`)?.options.preconditionOpts)
      .toEqual({ ifGenerationMatch: 0 });
    expect(memory.objects.get(`components/${DIGEST}.js`)?.options.preconditionOpts)
      .toEqual({ ifGenerationMatch: 0 });
  });

  test('accepts only the exact production bucket for the production project', () => {
    const memory = memoryBucket('miakapp-v4-components');
    expect(() => new ProductionFirebaseComponentStorage(memory.bucket, {
      environment: 'production',
      projectId: 'miakapp-v4',
      functionsEmulator: false,
      storageEmulatorHost: undefined,
      bucketName: 'miakapp-v4-components',
    })).not.toThrow();
  });
});
