import { describe, expect, it, vi } from 'vitest';

import { createHouseSnapshotStore, readLastAccount, settleAccount } from './house-snapshot';
import { createLiveHost, type LiveIdentity } from './live-host';
import type { BrowserClient, BrowserStateSnapshot } from './miakapi-browser';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
    clear: () => items.clear(),
  };
}

describe('house snapshots', () => {
  it('keeps values per account and per home', () => {
    const storage = memoryStorage();
    createHouseSnapshotStore('resident:a', storage).write('home-1', { values: { t: 20 }, homeName: 'Maison' });
    expect(createHouseSnapshotStore('resident:a', storage).read('home-1')).toMatchObject({ values: { t: 20 }, homeName: 'Maison' });
    expect(createHouseSnapshotStore('resident:a', storage).read('home-2')).toBeUndefined();
    expect(createHouseSnapshotStore('resident:b', storage).read('home-1')).toBeUndefined();
  });

  it('wipes every snapshot and the account hint on sign-out', () => {
    const storage = memoryStorage();
    settleAccount('a', storage);
    createHouseSnapshotStore('resident:a', storage).write('home-1', { values: { t: 20 } });
    expect(readLastAccount(storage)).toBe('a');
    settleAccount(null, storage);
    expect(readLastAccount(storage)).toBeUndefined();
    expect(createHouseSnapshotStore('resident:a', storage).read('home-1')).toBeUndefined();
  });

  it("drops the previous account's snapshots on an account switch", () => {
    const storage = memoryStorage();
    createHouseSnapshotStore('resident:a', storage).write('home-1', { values: { t: 20 } });
    createHouseSnapshotStore('resident:b', storage).write('home-1', { values: { t: 21 } });
    settleAccount('b', storage);
    expect(readLastAccount(storage)).toBe('b');
    expect(createHouseSnapshotStore('resident:a', storage).read('home-1')).toBeUndefined();
    expect(createHouseSnapshotStore('resident:b', storage).read('home-1')?.values).toEqual({ t: 21 });
  });
});

describe('live host with snapshots', () => {
  function setup(cached: Record<string, unknown> | undefined) {
    const storage = memoryStorage();
    const snapshots = (userId: string) => createHouseSnapshotStore(`resident:${userId}`, storage);
    if (cached !== undefined) snapshots('resident-a').write('synthetic-home', { values: cached });
    let emitState!: (snapshot: BrowserStateSnapshot) => void;
    const client = {
      status: 'idle',
      home: { snapshot: () => undefined, subscribe: () => () => undefined },
      state: { snapshot: () => undefined, subscribe: (listener: typeof emitState) => { emitState = listener; return () => undefined; } },
      calls: { start: vi.fn() },
      errors: { subscribe: () => () => undefined },
      start: vi.fn(async () => ({ sessionId: 1, connectedAtMs: 1, enrolled: true, coordinators: [] })),
      stop: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as BrowserClient;
    const identity: LiveIdentity = {
      isSignedIn: () => true,
      getUserId: () => 'resident-a',
      subscribe: () => () => undefined,
      signIn: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      getFirebaseIdToken: vi.fn(async () => 'firebase-token'),
      getAppCheckToken: vi.fn(async () => 'app-check-token'),
      dispose: vi.fn(),
    };
    const host = createLiveHost({
      exchangeEndpoint: 'https://control.example.test/v1/user-relay-tokens:exchange',
      home: { id: 'synthetic-home', name: 'Synthetic home', detail: '', accent: '#b8d9ff' },
      identity,
      snapshots,
    }, { createClient: () => client, createCredentialProvider: () => ({ getCredential: vi.fn() }) });
    return { host, snapshots, emit: (snapshot: BrowserStateSnapshot) => emitState(snapshot) };
  }

  it('opens on the cached values, marked old, until the relay answers', () => {
    const { host, emit } = setup({ t: 19.5 });
    expect(host.getSnapshot().homeState).toEqual({ values: { t: 19.5 }, revision: 0, stale: true });
    emit({ epoch: new Uint8Array(16), revision: 0, stale: true, values: {} });
    expect(host.getSnapshot().homeState).toEqual({ values: { t: 19.5 }, revision: 0, stale: true });
    emit({ epoch: new Uint8Array(16), revision: 4, stale: false, values: { t: 20 } });
    expect(host.getSnapshot().homeState).toEqual({ values: { t: 20 }, revision: 4, stale: false });
    host.dispose();
  });

  it('keeps the live values for the next visit', () => {
    const { host, emit, snapshots } = setup(undefined);
    expect(host.getSnapshot().homeState).toBeUndefined();
    emit({ epoch: new Uint8Array(16), revision: 2, stale: false, values: { t: 21 } });
    host.dispose();
    expect(snapshots('resident-a').read('synthetic-home')?.values).toEqual({ t: 21 });
  });
});
