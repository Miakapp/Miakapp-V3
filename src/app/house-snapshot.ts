// What a repeat visit draws before the network answers: the last values a home
// showed this account, its directory name and whether this account owns it.
//
// Kept per account and per home in the shell origin's storage, under the same
// `resident:<uid>` scope as consent and favorites. Signing out or switching
// account wipes every account's snapshot and the last-account hint, so nothing
// of one person's home is drawn for the next one.

import { safeLocalStorage } from './house-consent';
import type { HomeState } from './host';

const SNAPSHOT_PREFIX = 'miakapp.house-snapshot.v1:';
const LAST_ACCOUNT_KEY = 'miakapp.last-account.v1';
/** A home's local coordinates and this account's local ticket (direct mode). */
const DIRECT_PREFIX = 'miakapp.direct.v1:';
/** A home whose state outgrows this is simply not kept: it opens the slow way. */
const MAX_SNAPSHOT_BYTES = 512 * 1024;

export interface HouseSnapshot {
  readonly values: Readonly<Record<string, unknown>>;
  readonly homeName?: string;
  readonly viewerIsOwner?: boolean;
  readonly savedAt: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** The account this browser was last signed in with, read before Firebase answers. */
export function readLastAccount(storage: Storage | undefined = safeLocalStorage()): string | undefined {
  try {
    const value = storage?.getItem(LAST_ACCOUNT_KEY);
    return value === null || value === undefined || value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

/**
 * Records the account Firebase settled on. Any other account's snapshots, and
 * the hint itself on sign-out, are removed.
 */
export function settleAccount(userId: string | null, storage: Storage | undefined = safeLocalStorage()): void {
  if (storage === undefined) return;
  try {
    const scope = userId === null ? undefined : encodeURIComponent(`resident:${userId}`);
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      if (key.startsWith(SNAPSHOT_PREFIX) && key !== SNAPSHOT_PREFIX + scope) stale.push(key);
      if (key.startsWith(DIRECT_PREFIX) && (scope === undefined || !key.startsWith(`${DIRECT_PREFIX}${scope}:`))) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
    if (userId === null) storage.removeItem(LAST_ACCOUNT_KEY);
    else storage.setItem(LAST_ACCOUNT_KEY, userId);
  } catch {
    // Storage refused: there is nothing cached to wipe either.
  }
}

export interface HouseSnapshotStore {
  read(homeId: string): HouseSnapshot | undefined;
  /** Merges into the home's snapshot; `values` replaces the previous values. */
  write(homeId: string, patch: Partial<Omit<HouseSnapshot, 'savedAt'>>): void;
}

function parse(raw: string | null): Record<string, HouseSnapshot> {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, HouseSnapshot>
      : {};
  } catch {
    return {};
  }
}

export function createHouseSnapshotStore(
  scope: string,
  storage: Storage | undefined = safeLocalStorage(),
  now: () => number = Date.now,
): HouseSnapshotStore {
  const key = SNAPSHOT_PREFIX + encodeURIComponent(scope);
  const load = (): Record<string, HouseSnapshot> => {
    try {
      return parse(storage?.getItem(key) ?? null);
    } catch {
      return {};
    }
  };
  return {
    read(homeId) {
      const snapshot = load()[homeId];
      if (snapshot === undefined || snapshot.values === null || typeof snapshot.values !== 'object') return undefined;
      return snapshot;
    },
    write(homeId, patch) {
      const all = load();
      const next: HouseSnapshot = { values: {}, ...all[homeId], ...patch, savedAt: now() };
      const raw = JSON.stringify({ ...all, [homeId]: next });
      if (raw.length > MAX_SNAPSHOT_BYTES) return;
      try {
        storage?.setItem(key, raw);
      } catch {
        // Full or refused storage: the next visit opens the slow way.
      }
    },
  };
}

/** The cached values as the trusted host hands them out: always old, never ordered. */
export function staleStateFrom(snapshot: HouseSnapshot | undefined): HomeState | undefined {
  if (snapshot === undefined) return undefined;
  return Object.freeze({ values: snapshot.values, revision: 0, stale: true });
}

/** Repeat-visit timings, read by the open-time probe and visible in DevTools. */
export function markOpen(name: string): void {
  try {
    performance.mark(`miakapp:${name}`);
  } catch {
    // No Performance API: nothing to measure.
  }
}

export interface DirectStore {
  load(): unknown;
  save(value: unknown): void;
}

/**
 * Where the client keeps how to reach a home's coordinator on the local
 * network, and this account's local ticket for it. Same scope and same wipe
 * as the snapshots: signing out or switching account removes it.
 */
export function createDirectStore(
  userId: string,
  homeId: string,
  storage: Storage | undefined = safeLocalStorage(),
): DirectStore {
  const key = `${DIRECT_PREFIX}${encodeURIComponent(`resident:${userId}`)}:${encodeURIComponent(homeId)}`;
  return {
    load() {
      try {
        const raw = storage?.getItem(key);
        return raw === null || raw === undefined ? undefined : JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    },
    save(value) {
      try {
        if (value === undefined || value === null) storage?.removeItem(key);
        else storage?.setItem(key, JSON.stringify(value));
      } catch {
        // Refused storage: the home is reached through the relay only.
      }
    },
  };
}
