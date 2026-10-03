import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHouseConsentStore, HOUSE_CONSENT_VERSION } from './house-consent';

const KEY = 'miakapp.house-consent.v2:anonymous';
afterEach(() => localStorage.clear());

describe('observable house consent', () => {
  it('keeps a stable snapshot and notifies local grants and withdrawals', () => {
    const store = createHouseConsentStore(localStorage, () => 17);
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.grant('home-a');
    const first = store.read('home-a');
    expect(first).toEqual({ version: HOUSE_CONSENT_VERSION, grantedAt: 17 });
    expect(store.read('home-a')).toBe(first);
    expect(changed).toHaveBeenCalledOnce();
    store.revoke('home-a');
    expect(store.read('home-a')).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.grant('home-b');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('observes external changes and clear, but ignores other keys and storage areas', () => {
    const store = createHouseConsentStore(localStorage);
    store.grant('home-a');
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, storageArea: sessionStorage }));
    expect(changed).not.toHaveBeenCalled();
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(changed).toHaveBeenCalledOnce();
    expect(store.read('home-a')).toBeUndefined();
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, storageArea: localStorage }));
    expect(changed).toHaveBeenCalledOnce();
  });

  it('reads current storage rather than trusting a queued grant event', () => {
    const store = createHouseConsentStore(localStorage);
    store.grant('home-a');
    const obsolete = localStorage.getItem(KEY);
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: obsolete, storageArea: localStorage }));
    expect(changed).toHaveBeenCalledOnce();
    expect(store.read('home-a')).toBeUndefined();
    unsubscribe();
  });

  it('retains only page-local agreement when writes are unavailable', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } };
    const store = createHouseConsentStore(storage, () => 18);
    store.grant('home-a');
    expect(store.read('home-a')).toEqual({ version: HOUSE_CONSENT_VERSION, grantedAt: 18 });
    store.revoke('home-a');
    expect(store.read('home-a')).toBeUndefined();
    expect(createHouseConsentStore(storage).read('home-a')).toBeUndefined();
  });

  it('does not resurrect persisted consent after a failed withdrawal write', () => {
    const storage = {
      getItem: () => JSON.stringify({ 'home-a': { version: HOUSE_CONSENT_VERSION, grantedAt: 17 } }),
      setItem: () => { throw new Error('storage denied'); },
    };
    const store = createHouseConsentStore(storage);
    expect(store.read('home-a')).toBeDefined();
    store.revoke('home-a');
    expect(store.read('home-a')).toBeUndefined();
  });
});

 describe('resident agreement ownership', () => {
  it('does not transfer an agreement to another identity or anonymous visitor', () => {
    const a = createHouseConsentStore(localStorage, () => 17, 'account:a');
    a.grant('home-a');
    expect(createHouseConsentStore(localStorage, () => 18, 'account:b').read('home-a')).toBeUndefined();
    expect(createHouseConsentStore(localStorage).read('home-a')).toBeUndefined();
    expect(createHouseConsentStore(localStorage, () => 19, 'account:a').read('home-a')).toEqual({version: HOUSE_CONSENT_VERSION, grantedAt: 17});
  });
  it('leaves legacy ownerless consent untouched without assigning it', () => {
    const old = JSON.stringify({'home-a': {version: HOUSE_CONSENT_VERSION, grantedAt: 17}});
    localStorage.setItem('miakapp.house-consent', old);
    expect(createHouseConsentStore(localStorage, () => 18, 'account:b').read('home-a')).toBeUndefined();
    expect(localStorage.getItem('miakapp.house-consent')).toBe(old);
  });
  it('withdraws only the selected account and home', () => {
    const a = createHouseConsentStore(localStorage, () => 17, 'account:a');
    const b = createHouseConsentStore(localStorage, () => 18, 'account:b');
    a.grant('home-a'); a.grant('home-b'); b.grant('home-a');
    a.revoke('home-a');
    expect(a.read('home-a')).toBeUndefined();
    expect(a.read('home-b')).toBeDefined();
    expect(b.read('home-a')).toBeDefined();
  });
 });
