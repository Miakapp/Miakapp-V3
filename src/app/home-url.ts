/** A home's address in the web app: `/h/<id>` (www.miakapp.com/h/ma-maison). */
const HOME_ID = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u;
const HOME_PATH = /^\/h\/([^/]+)\/?$/u;

export function homePath(homeId: string): string {
  return `/h/${encodeURIComponent(homeId)}`;
}

/** The home this address asks for, or null when it names none. */
export function requestedHomeId(pathname: string): string | null {
  const match = HOME_PATH.exec(pathname);
  const candidate = match?.[1] === undefined ? null : decodeURIComponent(match[1]);
  return candidate !== null && HOME_ID.test(candidate) ? candidate : null;
}

/** Any address that opens the app itself rather than a product page (old `/app/…` links open it too). */
export function isAppPath(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/') || HOME_PATH.test(pathname);
}

/** A home's id or link (`ma-maison`, `miakapp.com/h/ma-maison`), typed by hand, or null. */
export function homeIdFromInput(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (!value.includes('/')) return requestedHomeId(`/h/${value}`);
  try {
    const url = new URL(/^https?:\/\//u.test(value) ? value : `https://${value}`);
    return requestedHomeId(url.pathname);
  } catch {
    return null;
  }
}
