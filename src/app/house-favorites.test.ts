import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountBackedHomes, createHouseFavoritesStore, syncAccountHomes } from './house-favorites';

const home = { id: 'private-home', name: 'Private resident home' };
beforeEach(() => localStorage.clear());

it('separates identities, anonymous and preview lists and restores the original resident', () => {
  createHouseFavoritesStore(localStorage, 'resident:a').add(home);
  expect(createHouseFavoritesStore(localStorage, 'resident:b').list()).toEqual([]);
  expect(createHouseFavoritesStore(localStorage).list()).toEqual([]);
  expect(createHouseFavoritesStore(localStorage, 'preview').list()).toEqual([]);
  expect(createHouseFavoritesStore(localStorage, 'resident:a').list()).toEqual([home]);
});

it('does not assign legacy ownerless favorites to a new identity', () => {
  const legacy = JSON.stringify([home]);
  localStorage.setItem('miakapp.favorite-homes', legacy);
  expect(createHouseFavoritesStore(localStorage, 'resident:a').list()).toEqual([]);
  expect(createHouseFavoritesStore(localStorage).list()).toEqual([]);
  expect(localStorage.getItem('miakapp.favorite-homes')).toBe(legacy);
});

it('does not resurrect a removed favorite when persistent writes fail', () => {
  const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
  const store = createHouseFavoritesStore(storage, 'resident:a');
  store.add(home);
  const serialized = storage.setItem.mock.calls[0] as unknown as [string, string];
  storage.getItem.mockReturnValue(serialized[1]);
  storage.setItem.mockImplementation(() => { throw new Error('quota'); });
  store.remove(home.id);
  expect(store.list()).toEqual([]);
});

it('notifies mounted stores in this document and reads current cross-tab storage', () => {
  const store = createHouseFavoritesStore(localStorage, 'resident:a');
  const sibling = createHouseFavoritesStore(localStorage, 'resident:a');
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const empty = store.list();
  expect(store.list()).toBe(empty);
  sibling.add(home);
  expect(listener).toHaveBeenCalled();
  const snapshot = store.list();
  expect(snapshot).toEqual([home]);
  expect(store.list()).toBe(snapshot);
  listener.mockClear();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.list()).toEqual([]);
  unsubscribe();
  listener.mockClear();
  sibling.add(home);
  expect(listener).not.toHaveBeenCalled();
});

describe('« My homes » on the account', () => {
  const account = () => ({
    added: [] as string[],
    removed: [] as string[],
    async addMyHome(id: string) { this.added.push(id); },
    async removeMyHome(id: string) { this.removed.push(id); },
  });

  it('sends homes kept on this device to the account once, then follows the account', () => {
    const storage = new Map<string, string>();
    const kv = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } };
    const local = createHouseFavoritesStore(kv, 'acct');
    local.add({ id: 'old-home', name: 'Old' });
    const remote = account();
    syncAccountHomes(local, remote, [{ id: 'friends', name: 'Friends' }], 'migrated', kv);
    expect(remote.added).toEqual(['old-home']);
    expect(local.list().map((home) => home.id).sort()).toEqual(['friends', 'old-home']);

    // Later the account no longer lists old-home: removed on another device.
    syncAccountHomes(local, remote, [{ id: 'friends', name: 'Friends' }], 'migrated', kv);
    expect(local.list().map((home) => home.id)).toEqual(['friends']);
    expect(remote.added).toEqual(['old-home']);
  });

  it('makes every change on the account too', () => {
    const local = createHouseFavoritesStore(undefined, 'acct2');
    const remote = account();
    const homes = accountBackedHomes(local, remote);
    homes.add({ id: 'ma-maison', name: 'Maison' });
    homes.remove('ma-maison');
    expect(remote.added).toEqual(['ma-maison']);
    expect(remote.removed).toEqual(['ma-maison']);
    expect(homes.list()).toEqual([]);
  });
});
