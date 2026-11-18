/**
 * What a home's link carried besides the home itself: `?invite=…`, `#…`.
 * Miakapp does not read it; it hands it to the home's app (`miakapp.link`),
 * whose own code decides what to do with it (send an invite to its
 * coordinator, open a page…). Kept for this tab only, so it survives sign-in
 * and the first-visit consent but never follows the person elsewhere.
 */
import { requestedHomeId } from './home-url';

export interface HomeLink {
  /** First value of each query parameter, Miakapp's own excluded. */
  readonly params: Readonly<Record<string, string>>;
  /** The fragment without `#`, or ''. */
  readonly hash: string;
}

export const EMPTY_HOME_LINK: HomeLink = Object.freeze({ params: Object.freeze({}), hash: '' });

const KEY_PREFIX = 'miakapp.home-link.v1:';
const MAX_LENGTH = 2_048;
const MAX_PARAMS = 32;
/** Parameters Miakapp itself uses (sign-in links, notification taps). */
const OWN_PARAMS = new Set(['oobCode', 'mode', 'apiKey', 'lang', 'continueUrl', 'tenantId', 'from']);

/** Parses a link's query and fragment; anything over the bounds is dropped. */
export function parseHomeLink(search: string, hash: string): HomeLink {
  const params: Record<string, string> = {};
  if (search.length <= MAX_LENGTH) {
    for (const [key, value] of new URLSearchParams(search)) {
      if (OWN_PARAMS.has(key) || Object.hasOwn(params, key) || key === '' || key === '__proto__') continue;
      if (Object.keys(params).length >= MAX_PARAMS) break;
      params[key] = value;
    }
  }
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return Object.freeze({
    params: Object.freeze(params),
    hash: fragment.length <= MAX_LENGTH ? fragment : '',
  });
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Called once at start: keeps what a `/h/<id>?…#…` address carried for that home. */
export function captureHomeLink(location: Pick<Location, 'pathname' | 'search' | 'hash'>): void {
  const homeId = requestedHomeId(location.pathname);
  if (homeId === null) return;
  const link = parseHomeLink(location.search, location.hash);
  if (Object.keys(link.params).length === 0 && link.hash === '') return;
  try {
    storage()?.setItem(`${KEY_PREFIX}${homeId}`, JSON.stringify(link));
  } catch {
    // Storage full or blocked: the link is simply not handed over.
  }
}

/** What the last link to this home carried in this tab, or an empty link. */
export function homeLinkFor(homeId: string): HomeLink {
  try {
    const raw = storage()?.getItem(`${KEY_PREFIX}${homeId}`);
    if (raw == null) return EMPTY_HOME_LINK;
    const value = JSON.parse(raw) as { params?: unknown; hash?: unknown };
    const params = value.params !== null && typeof value.params === 'object' ? value.params as Record<string, unknown> : {};
    return parseHomeLink(
      new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString(),
      typeof value.hash === 'string' ? value.hash : '',
    );
  } catch {
    return EMPTY_HOME_LINK;
  }
}
