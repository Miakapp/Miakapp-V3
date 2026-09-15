import { describe, expect, it, vi } from 'vitest';

import {
  COMPONENT_ABI,
  POINTER_SCHEMA,
  type ComponentPointerV1,
} from '../../component-runtime/src/contract';
import { sha256Base64Url } from '../../component-runtime/src/artifact';
import type { ArtifactCache } from '../../component-runtime/src/artifact-cache';
import {
  RELEASE_STATE_SCHEMA,
  type ComponentReleaseState,
  type ReleaseMetadataMutation,
  type ReleaseMetadataStore,
} from '../../component-runtime/src/release-state';

import {
  createComponentReleaseCoordinator,
  createControlPlanePointerReader,
} from './component-release';

const HOME_ID = 'home-test';
const ARTIFACT_ORIGIN = 'https://artifacts.example';

const encoder = new TextEncoder();

function bytesFor(body: string): Uint8Array {
  return encoder.encode(body);
}

async function pointerFor(generation: number, body: string): Promise<ComponentPointerV1> {
  const bytes = bytesFor(body);
  const sha256 = await sha256Base64Url(bytes);
  return {
    schema: POINTER_SCHEMA,
    home_id: HOME_ID,
    generation,
    release: `release-${generation}`,
    abi: COMPONENT_ABI,
    url: `${ARTIFACT_ORIGIN}/homes/${HOME_ID}/${generation}.js`,
    sha256,
    size: bytes.byteLength,
    requires: {
      state_read: ['global.*'],
      event_subscribe: [],
      event_publish: [],
      call: [],
      presentation: [],
    },
  };
}

class MemoryStore implements ReleaseMetadataStore {
  #records = new Map<string, unknown>();

  async read(homeId: string): Promise<unknown | undefined> {
    return this.#records.get(homeId);
  }

  async transact<T>(
    homeId: string,
    mutation: (current: unknown | undefined) => ReleaseMetadataMutation<T>,
  ): Promise<T> {
    const result = mutation(this.#records.get(homeId));
    this.#records.set(homeId, result.record);
    return result.value;
  }

  seed(state: ComponentReleaseState): void {
    this.#records.set(state.home_id, state);
  }

  current(): ComponentReleaseState | undefined {
    return this.#records.get(HOME_ID) as ComponentReleaseState | undefined;
  }
}

class MemoryCache implements ArtifactCache {
  readonly entries = new Map<string, Uint8Array>();

  async get(homeId: string, sha256: string): Promise<Uint8Array | undefined> {
    return this.entries.get(`${homeId}/${sha256}`);
  }

  async put(homeId: string, sha256: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(`${homeId}/${sha256}`, bytes);
  }

  async delete(homeId: string, sha256: string): Promise<void> {
    this.entries.delete(`${homeId}/${sha256}`);
  }
}

function artifactResponse(body: string): Response {
  // A string body is encoded as UTF-8, so it matches the digest computed above.
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/javascript' },
  });
}

function coordinatorFor(
  pointer: unknown,
  overrides: {
    readonly store: MemoryStore;
    readonly cache: MemoryCache;
    readonly fetch: typeof globalThis.fetch;
  },
) {
  return createComponentReleaseCoordinator({
    homeId: HOME_ID,
    allowedArtifactOrigins: new Set([ARTIFACT_ORIGIN]),
    allowedPathPrefixes: ['/homes/'],
    readPointer: async () => pointer,
    store: overrides.store,
    cache: overrides.cache,
    fetch: overrides.fetch,
  });
}

describe('component release coordinator', () => {
  it('accepts the pointer, verifies the artifact and records last-known-good', async () => {
    const pointer = await pointerFor(7, 'export const a = 1;');
    const store = new MemoryStore();
    const cache = new MemoryCache();
    const fetch = vi.fn(async () => artifactResponse('export const a = 1;'));

    const activated = await coordinatorFor(pointer, {
      store,
      cache,
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).activate();

    expect(activated.fellBack).toBe(false);
    expect(activated.pointer.generation).toBe(7);
    expect(activated.artifact.source).toBe('network');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.current()?.last_known_good?.sha256).toBe(pointer.sha256);
    expect(cache.entries.size).toBe(1);
  });

  it('serves the second activation from the verified cache without refetching', async () => {
    const pointer = await pointerFor(7, 'export const a = 1;');
    const store = new MemoryStore();
    const cache = new MemoryCache();
    const fetch = vi.fn(async () => artifactResponse('export const a = 1;'));
    const options = {
      store,
      cache,
      fetch: fetch as unknown as typeof globalThis.fetch,
    };

    await coordinatorFor(pointer, options).activate();
    const second = await coordinatorFor(pointer, options).activate();

    expect(second.artifact.source).toBe('cache');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a pointer below the anti-rollback floor', async () => {
    const accepted = await pointerFor(9, 'export const a = 9;');
    const older = await pointerFor(8, 'export const a = 8;');
    const store = new MemoryStore();
    store.seed({
      schema: RELEASE_STATE_SCHEMA,
      home_id: HOME_ID,
      highest_accepted: accepted,
    } as ComponentReleaseState);
    const fetch = vi.fn(async () => artifactResponse('export const a = 8;'));

    await expect(coordinatorFor(older, {
      store,
      cache: new MemoryCache(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).activate()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the last-known-good when the candidate artifact fails to verify', async () => {
    const good = await pointerFor(4, 'export const a = 4;');
    const broken = await pointerFor(5, 'export const a = 5;');
    const store = new MemoryStore();
    store.seed({
      schema: RELEASE_STATE_SCHEMA,
      home_id: HOME_ID,
      highest_accepted: good,
      last_known_good: good,
    } as ComponentReleaseState);
    const fetch = vi.fn(async (input: unknown) => (
      String(input) === broken.url
        ? artifactResponse('tampered bundle')
        : artifactResponse('export const a = 4;')
    ));

    const activated = await coordinatorFor(broken, {
      store,
      cache: new MemoryCache(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).activate();

    expect(activated.fellBack).toBe(true);
    expect(activated.pointer.sha256).toBe(good.sha256);
    // The failed candidate never becomes last-known-good.
    expect(store.current()?.last_known_good?.sha256).toBe(good.sha256);
    expect(store.current()?.highest_accepted.generation).toBe(5);
  });

  it('rethrows when no last-known-good is available for fallback', async () => {
    const broken = await pointerFor(2, 'export const a = 2;');
    const fetch = vi.fn(async () => artifactResponse('tampered bundle'));

    await expect(coordinatorFor(broken, {
      store: new MemoryStore(),
      cache: new MemoryCache(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).activate()).rejects.toThrow();
  });
});

describe('control plane pointer reader', () => {
  it('reads the RFC 0004 §13.2 route with an authorization header', async () => {
    const pointer = await pointerFor(3, 'export const a = 3;');
    const fetch = vi.fn(async () => new Response(JSON.stringify(pointer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const read = createControlPlanePointerReader({
      endpoint: 'https://control.example/',
      homeId: HOME_ID,
      authorize: async () => 'Bearer token-value',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(read()).resolves.toMatchObject({ generation: 3 });
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://control.example/v1/homes/${HOME_ID}/component-pointer`);
    expect((request.headers as Record<string, string>).authorization).toBe('Bearer token-value');
    expect((request.headers as Record<string, string>)['x-firebase-appcheck']).toBeUndefined();
    expect(request.credentials).toBe('omit');
  });

  it('proves app integrity with App Check and threads the caller abort signal', async () => {
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ generation: 3 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const seen: Array<AbortSignal | undefined> = [];
    const read = createControlPlanePointerReader({
      endpoint: 'https://control.example',
      homeId: HOME_ID,
      authorize: async (signal) => {
        seen.push(signal);
        return 'Bearer token-value';
      },
      appCheckToken: async (signal) => {
        seen.push(signal);
        return 'appcheck-value';
      },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const controller = new AbortController();
    await expect(read(controller.signal)).resolves.toMatchObject({ generation: 3 });

    const [, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((request.headers as Record<string, string>)['x-firebase-appcheck'])
      .toBe('appcheck-value');
    expect(request.signal).toBe(controller.signal);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  it('rejects a non-ok pointer response', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    const read = createControlPlanePointerReader({
      endpoint: 'https://control.example',
      homeId: HOME_ID,
      authorize: async () => 'Bearer token-value',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(read()).rejects.toThrow('HTTP 503');
  });
});
