/**
 * Test sessions (`miakapp open`, `miakapp preview`, `miakapp check --taps`):
 * the home's agent opens the real published home as a stand-in member
 * `test:<role>`, from a short-lived ticket minted with its Home Key. No account
 * is signed in and nothing is kept: no consent, no « My homes », no push.
 *
 * The ticket arrives in the fragment (`#miakapp-test=…`, never sent to a
 * server), is kept for this tab only, and is removed from the address bar
 * before anything else reads it.
 */
import type { ReleaseMetadataMutation, ReleaseMetadataStore } from '../../component-runtime/src/release-state';
import { HouseCallError } from '../../component-runtime/src/app-host';

import type { HouseCallOptions, TrustedHost } from './host';
import type { LiveIdentity } from './live-host';
import { requestedHomeId } from './home-url';

export interface TestSession {
  readonly ticket: string;
  readonly homeId: string;
  readonly role: string;
  readonly release: string | null;
  readonly expiresAtMs: number;
}

const KEY_PREFIX = 'miakapp.test-session.v1:';
const FRAGMENT = /(?:^|&)miakapp-test=(mkt1\.[A-Za-z0-9_.-]+)/u;

function decodeClaims(ticket: string): { home?: unknown; role?: unknown; release?: unknown; exp?: unknown } | undefined {
  const payload = ticket.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const json = atob(payload.replace(/-/gu, '+').replace(/_/gu, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sessionFrom(ticket: string): TestSession | undefined {
  const claims = decodeClaims(ticket);
  if (claims === undefined || typeof claims.home !== 'string' || typeof claims.role !== 'string'
    || typeof claims.exp !== 'number') return undefined;
  return Object.freeze({
    ticket,
    homeId: claims.home,
    role: claims.role,
    release: typeof claims.release === 'string' ? claims.release : null,
    expiresAtMs: claims.exp * 1_000,
  });
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a ticket the address carried, then removes it from the address. */
export function captureTestSession(location: Pick<Location, 'pathname' | 'search' | 'hash'>): void {
  const homeId = requestedHomeId(location.pathname);
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const ticket = FRAGMENT.exec(fragment)?.[1];
  if (homeId === null || ticket === undefined) return;
  const session = sessionFrom(ticket);
  if (session !== undefined && session.homeId === homeId) {
    storage()?.setItem(`${KEY_PREFIX}${homeId}`, ticket);
  }
  const rest = fragment.replace(FRAGMENT, '').replace(/^&/u, '');
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${rest === '' ? '' : `#${rest}`}`);
  } catch {
    // The ticket stays visible; it expires on its own.
  }
}

/** The live test session of this tab for this home, if any. */
export function readTestSession(homeId: string, now = Date.now()): TestSession | undefined {
  const ticket = storage()?.getItem(`${KEY_PREFIX}${homeId}`);
  if (ticket == null) return undefined;
  const session = sessionFrom(ticket);
  return session !== undefined && session.homeId === homeId && session.expiresAtMs > now ? session : undefined;
}

export function endTestSession(homeId: string): void {
  storage()?.removeItem(`${KEY_PREFIX}${homeId}`);
}

/** The identity of a test session: `test:<role>`, authorized by its ticket. */
export class TestSessionIdentity implements LiveIdentity {
  readonly #session: TestSession;

  constructor(session: TestSession) {
    this.#session = session;
  }

  readonly isSignedIn = (): boolean => true;
  readonly getUserId = (): string => `test:${this.#session.role}`;
  readonly subscribe = (): (() => void) => () => undefined;
  readonly signIn = async (): Promise<void> => undefined;
  readonly signOut = async (): Promise<void> => {
    endTestSession(this.#session.homeId);
    window.location.reload();
  };

  readonly getFirebaseIdToken: LiveIdentity['getFirebaseIdToken'] = async ({ signal }) => {
    if (signal.aborted) throw signal.reason;
    if (this.#session.expiresAtMs <= Date.now()) throw new Error('The test session has expired');
    return this.#session.ticket;
  };

  /** The control plane does not ask a test session for App Check. */
  readonly getAppCheckToken: LiveIdentity['getAppCheckToken'] = async () => 'test-session';

  readonly dispose = (): void => undefined;
}

/** A test preview must not touch the release history real visits rely on. */
export class MemoryReleaseStore implements ReleaseMetadataStore {
  readonly #records = new Map<string, unknown>();

  async read(homeId: string): Promise<unknown | undefined> {
    return this.#records.get(homeId);
  }

  async transact<T>(
    homeId: string,
    mutation: (current: unknown | undefined) => ReleaseMetadataMutation<T>,
  ): Promise<T> {
    const result = mutation(this.#records.get(homeId));
    this.#records.set(homeId, result.record);
    return result.value;
  }
}

export interface TestCallRecord {
  readonly at: number;
  readonly name: string;
  readonly args: unknown;
  /** `held`: not sent (a tap check holds what taps would send to the house). */
  outcome: 'pending' | 'ok' | 'error' | 'held';
  error?: string;
  ms?: number;
}

/**
 * What the agent's tools read and steer through the browser
 * (`window.miakappTest`): every call the app made, and a switch that holds
 * calls instead of sending them, so tapping a button never moves the house.
 */
export interface TestHook {
  readonly role: string;
  readonly release: string | null;
  readonly expiresAtMs: number;
  readonly calls: TestCallRecord[];
  /** true, or a test per function name: true holds the call. */
  hold: boolean | ((name: string) => boolean);
}

declare global {
  interface Window { miakappTest?: TestHook }
}

/** Records every call, and holds them while `miakappTest.hold` is true. */
export function instrumentTestHost(host: TrustedHost, session: TestSession): TrustedHost {
  const hook: TestHook = {
    role: session.role,
    release: session.release,
    expiresAtMs: session.expiresAtMs,
    calls: [],
    hold: false,
  };
  window.miakappTest = hook;
  const call = async (name: string, args: unknown, options: HouseCallOptions): Promise<unknown> => {
    const record: TestCallRecord = { at: Date.now(), name, args, outcome: 'pending' };
    hook.calls.push(record);
    if (hook.calls.length > 500) hook.calls.splice(0, hook.calls.length - 500);
    if (typeof hook.hold === 'function' ? hook.hold(name) : hook.hold) {
      record.outcome = 'held';
      // Never sent. The app sees the home as briefly unreachable.
      throw new HouseCallError('unavailable');
    }
    try {
      if (host.call === undefined) throw new HouseCallError('unavailable');
      const result = await host.call(name, args, options);
      record.outcome = 'ok';
      return result;
    } catch (error) {
      record.outcome = 'error';
      record.error = error instanceof HouseCallError ? error.code : String(error);
      throw error;
    } finally {
      record.ms = Date.now() - record.at;
    }
  };
  return new Proxy(host, {
    get: (target, property) => (property === 'call' ? call : Reflect.get(target, property)),
  });
}

/** Phone size, and a mark beside it: this is a test session, as `test:<role>`. */
export function showTestSession(session: TestSession): void {
  document.documentElement.classList.add('miakapp-test');
  const badge = document.createElement('div');
  badge.className = 'miakapp-test-badge';
  badge.textContent = `Test session · test:${session.role}${session.release === null ? '' : ' · preview'}`;
  badge.setAttribute('role', 'note');
  document.body.append(badge);
}
