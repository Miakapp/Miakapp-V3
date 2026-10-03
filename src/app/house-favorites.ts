// Homes the resident pinned, kept by the shell so the switcher can list them
// without a home ever being able to read or edit the list. Membership is still
// decided by the control plane when a home is opened; a favorite is only a
// shortcut, never an access grant.

import { safeLocalStorage } from './house-consent';

const STORAGE_KEY = 'miakapp.favorite-homes';
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
  list(): readonly FavoriteHome[];
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

export function createHouseFavoritesStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage(),
): HouseFavoritesStore {
  let memory: FavoriteHome[] = [];
  const load = (): FavoriteHome[] => {
    try {
      return storage === undefined ? memory : parse(storage.getItem(STORAGE_KEY));
    } catch {
      return memory;
    }
  };
  const save = (value: FavoriteHome[]): readonly FavoriteHome[] => {
    memory = value;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Kept in memory for this page.
    }
    return Object.freeze([...value]);
  };
  return {
    list: () => Object.freeze(load()),
    add(home) {
      if (!isHomeId(home.id)) return Object.freeze(load());
      const rest = load().filter((entry) => entry.id !== home.id);
      return save([{ id: home.id, name: home.name.slice(0, 80), ...(home.accent ? { accent: home.accent } : {}) }, ...rest]
        .slice(0, MAX_FAVORITES));
    },
    remove(homeId) {
      return save(load().filter((entry) => entry.id !== homeId));
    },
  };
}
