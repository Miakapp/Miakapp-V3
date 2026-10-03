// The resident's agreement to open one home's own interface.
//
// A home's interface is written by whoever runs that home, not by Miakapp. The
// shell says so and waits for an explicit yes before it fetches, verifies or
// runs anything of that home's UI. The yes is kept per home and per notice
// version: a materially different notice asks again. A no is not kept — the
// person is asked again next time rather than silently locked out.

/** Bump when the notice changes in a way that should ask everyone again. */
export const HOUSE_CONSENT_VERSION = 1;

const STORAGE_KEY = 'miakapp.house-consent';

export interface HouseConsentRecord {
  readonly version: number;
  readonly grantedAt: number;
}

export interface HouseConsentStore {
  read(homeId: string): HouseConsentRecord | undefined;
  grant(homeId: string): HouseConsentRecord;
  revoke(homeId: string): void;
}

type Stored = Record<string, HouseConsentRecord>;

function parse(raw: string | null): Stored {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Stored = {};
    for (const [homeId, record] of Object.entries(value as Record<string, unknown>)) {
      if (record === null || typeof record !== 'object') continue;
      const { version, grantedAt } = record as Record<string, unknown>;
      if (Number.isSafeInteger(version) && Number.isSafeInteger(grantedAt)) {
        result[homeId] = { version: version as number, grantedAt: grantedAt as number };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Keeps agreements in the shell origin's storage. When storage is unavailable
 * the agreement lives for this page only, which errs toward asking again.
 */
export function createHouseConsentStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage(),
  now: () => number = Date.now,
): HouseConsentStore {
  let memory: Stored = {};
  const load = (): Stored => {
    try {
      return storage === undefined ? memory : parse(storage.getItem(STORAGE_KEY));
    } catch {
      return memory;
    }
  };
  const save = (value: Stored): void => {
    memory = value;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Memory copy above already holds it for this page.
    }
  };
  return {
    read(homeId) {
      const record = load()[homeId];
      return record !== undefined && record.version === HOUSE_CONSENT_VERSION ? record : undefined;
    },
    grant(homeId) {
      const record = Object.freeze({ version: HOUSE_CONSENT_VERSION, grantedAt: now() });
      save({ ...load(), [homeId]: record });
      return record;
    },
    revoke(homeId) {
      const next = { ...load() };
      delete next[homeId];
      save(next);
    },
  };
}

export function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
