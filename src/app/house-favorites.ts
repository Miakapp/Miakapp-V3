// Homes the resident pinned, kept by the shell so the switcher can list them
// without a home ever being able to read or edit the list. Membership is still
// decided by the control plane when a home is opened; a favorite is only a
// shortcut, never an access grant.

import { safeLocalStorage } from './house-consent';

const STORAGE_PREFIX = 'miakapp.favorite-homes.v2:';
const CHANGE_EVENT = 'miakapp:favorite-homes-changed';
const EMPTY: readonly FavoriteHome[] = Object.freeze([]);
// Control-plane home IDs, plus the underscore the offline preview's fictional
// homes use. A favorite is a shortcut, so this is shape-checking, not trust.
const HOME_ID = /^[a-z][a-z0-9_-]{1,61}[a-z0-9]$/u;
const MAX_FAVORITES = 24;

export interface FavoriteHome {
  readonly id: string;
  readonly name: string;
  readonly accent?: string;
}

export interface HouseFavoritesStore {
  /** Stable snapshots, including changes from another tab. */
  list(): readonly FavoriteHome[];
  subscribe(listener: () => void): () => void;
  add(home: FavoriteHome): readonly FavoriteHome[];
  remove(homeId: string): readonly FavoriteHome[];
}

export function isHomeId(value: string): boolean {
  return HOME_ID.test(value);
}

function parse(raw: string | null): FavoriteHome[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: FavoriteHome[] = [];
    for (const entry of value as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const { id, name, accent } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || !isHomeId(id) || seen.has(id)) continue;
      if (typeof name !== 'string' || name.trim() === '' || name.length > 80) continue;
      seen.add(id);
      result.push(Object.freeze({
        id,
        name,
        ...(typeof accent === 'string' && /^#[0-9a-f]{6}$/iu.test(accent) ? { accent } : {}),
      }));
    }
    return result.slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/**
 * Scope comes only from the trusted identity boundary, never a home or URL.
 * Ownerless v1 data is left untouched, but cannot safely be claimed by whichever
 * account happens to sign in next. Anonymous and preview lists stay separate.
 */
export function createHouseFavoritesStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage(),
  scope = 'anonymous',
): HouseFavoritesStore {
  const storageKey = STORAGE_PREFIX + encodeURIComponent(scope);
  let memory: readonly FavoriteHome[] = EMPTY;
  let memoryOnly = storage === undefined;
  let cachedRaw: string | null | undefined;
  let cached: readonly FavoriteHome[] = EMPTY;
  const listeners = new Set<() => void>();
  const notify = (): void => { listeners.forEach((listener) => listener()); };
  const onStorage = (event: StorageEvent): void => {
    if (memoryOnly || event.storageArea !== storage) return;
    if (event.key === storageKey || event.key === null) notify();
  };
  const load = (): readonly FavoriteHome[] => {
    try {
      if (memoryOnly || storage === undefined) return memory;
      const raw = storage.getItem(storageKey);
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        cached = Object.freeze(parse(raw));
      }
      return cached;
    } catch {
      return memory;
    }
  };
  const save = (value: FavoriteHome[]): readonly FavoriteHome[] => {
    memory = Object.freeze(value);
    try {
      if (!memoryOnly) storage?.setItem(storageKey, JSON.stringify(value));
    } catch {
      // A failed removal must not resurrect an old persisted favorite.
      memoryOnly = true;
    }
    notify();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
    return memory;
  };
  return {
    list: load,
    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        window.addEventListener(CHANGE_EVENT, notify);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
          window.removeEventListener(CHANGE_EVENT, notify);
        }
      };
    },
    add(home) {
      if (!isHomeId(home.id)) return load();
      const rest = load().filter((entry) => entry.id !== home.id);
      return save([{ id: home.id, name: home.name.slice(0, 80), ...(home.accent ? { accent: home.accent } : {}) }, ...rest]
        .slice(0, MAX_FAVORITES));
    },
    remove(homeId) {
      return save(load().filter((entry) => entry.id !== homeId));
    },
  };
}
