import {
  fetchAndVerifyArtifact,
  verifyArtifactBytes,
  type ArtifactFetchOptions,
  type VerifiedArtifact,
} from './artifact';
import {
  ContractViolation,
  type ComponentPointerV1,
} from './contract';

const DATABASE_NAME = 'miakapp-component-runtime-v1';
const DATABASE_VERSION = 1;
const ARTIFACT_STORE = 'artifacts';

interface ArtifactRecord {
  readonly key: string;
  readonly homeId: string;
  readonly sha256: string;
  readonly bytes: ArrayBuffer;
}

export interface ArtifactCache {
  get(homeId: string, sha256: string): Promise<Uint8Array | undefined>;
  put(homeId: string, sha256: string, bytes: Uint8Array): Promise<void>;
  delete(homeId: string, sha256: string): Promise<void>;
}

export interface ArtifactLoadOptions extends ArtifactFetchOptions {
  readonly cache?: ArtifactCache;
  readonly onCacheError?: (error: unknown) => void;
}

export interface LoadedArtifact extends VerifiedArtifact {
  readonly source: 'cache' | 'network';
}

function cacheKey(homeId: string, sha256: string): string {
  return `${homeId}\u0000${sha256}`;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function reportCacheError(options: ArtifactLoadOptions, error: unknown): void {
  try {
    options.onCacheError?.(error);
  } catch {
    // Cache observability cannot become an artifact-availability dependency.
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    }, { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    }, { once: true });
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    }, { once: true });
  });
}

export class IndexedDbArtifactCache implements ArtifactCache {
  readonly #database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(ARTIFACT_STORE)) {
        request.result.createObjectStore(ARTIFACT_STORE, { keyPath: 'key' });
      }
    });
    this.#database = requestResult(request);
  }

  async get(homeId: string, sha256: string): Promise<Uint8Array | undefined> {
    const database = await this.#database;
    const transaction = database.transaction(ARTIFACT_STORE, 'readonly');
    const record = await requestResult(
      transaction.objectStore(ARTIFACT_STORE).get(cacheKey(homeId, sha256)),
    ) as ArtifactRecord | undefined;
    await transactionComplete(transaction);
    if (record === undefined) return undefined;
    if (record.homeId !== homeId || record.sha256 !== sha256 || !(record.bytes instanceof ArrayBuffer)) {
      await this.delete(homeId, sha256);
      return undefined;
    }
    return copyBytes(new Uint8Array(record.bytes));
  }

  async put(homeId: string, sha256: string, bytes: Uint8Array): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(ARTIFACT_STORE, 'readwrite');
    const storedBytes = copyBytes(bytes);
    transaction.objectStore(ARTIFACT_STORE).put({
      key: cacheKey(homeId, sha256),
      homeId,
      sha256,
      bytes: storedBytes.buffer,
    } satisfies ArtifactRecord);
    await transactionComplete(transaction);
  }

  async delete(homeId: string, sha256: string): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(ARTIFACT_STORE, 'readwrite');
    transaction.objectStore(ARTIFACT_STORE).delete(cacheKey(homeId, sha256));
    await transactionComplete(transaction);
  }
}

export async function loadVerifiedArtifact(
  pointer: ComponentPointerV1,
  options: ArtifactLoadOptions,
): Promise<LoadedArtifact> {
  let cached: Uint8Array | undefined;
  try {
    cached = await options.cache?.get(pointer.home_id, pointer.sha256);
  } catch (error) {
    reportCacheError(options, error);
  }
  if (cached !== undefined) {
    try {
      const verified = await verifyArtifactBytes(pointer, cached);
      return { ...verified, bytes: copyBytes(verified.bytes), source: 'cache' };
    } catch (error) {
      if (!(error instanceof ContractViolation)) throw error;
      try {
        await options.cache?.delete(pointer.home_id, pointer.sha256);
      } catch (cacheError) {
        reportCacheError(options, cacheError);
      }
    }
  }

  const verified = await fetchAndVerifyArtifact(pointer, options);
  try {
    await options.cache?.put(pointer.home_id, pointer.sha256, copyBytes(verified.bytes));
  } catch (error) {
    reportCacheError(options, error);
  }
  return { ...verified, bytes: copyBytes(verified.bytes), source: 'network' };
}
