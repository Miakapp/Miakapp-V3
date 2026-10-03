import { beforeEach, expect, it, vi } from 'vitest';
import { createHouseFavoritesStore } from './house-favorites';

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
