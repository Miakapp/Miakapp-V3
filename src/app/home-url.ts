/**
 * A home's address in the web app: `/app/<id>` today, `/h/<id>` once
 * miakapp.com serves V4. Both are read; `homePath` is the one Miakapp writes.
 * The legacy `/app?home=<id>` still opens and is rewritten to the new form.
 */
const HOME_ID = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u;
const HOME_PATH = /^\/(?:app|h)\/([^/]+)\/?$/u;

export function homePath(homeId: string): string {
  return `/app/${encodeURIComponent(homeId)}`;
}

/** The home this address asks for, or null when it names none. */
export function requestedHomeId(pathname: string, search: string): string | null {
  const match = HOME_PATH.exec(pathname);
  const candidate = match?.[1] !== undefined
    ? decodeURIComponent(match[1])
    : pathname === '/app' ? new URLSearchParams(search).get('home') : null;
  return candidate !== null && HOME_ID.test(candidate) ? candidate : null;
}

/** Any address that opens the app itself rather than a product page. */
export function isAppPath(pathname: string): boolean {
  return pathname === '/app' || HOME_PATH.test(pathname);
}

/** Rewrites a legacy `/app?home=<id>` address in place, keeping its other parameters. */
export function canonicalizeHomeAddress(location: Location, history: History): void {
  if (location.pathname !== '/app') return;
  const params = new URLSearchParams(location.search);
  const id = params.get('home');
  if (id === null || !HOME_ID.test(id)) return;
  params.delete('home');
  const query = params.toString();
  history.replaceState(history.state, '', `${homePath(id)}${query === '' ? '' : `?${query}`}${location.hash}`);
}
