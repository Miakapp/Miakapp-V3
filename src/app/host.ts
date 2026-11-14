export type HomeConnectionStatus =
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'unavailable';

export interface HomeSummary {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly accent: string;
}

/**
 * The home's own state as the trusted host holds it, before the home's interface sees
 * it. `revision` is the relay's, so it is what a consumer orders updates by;
 * `stale` is exposed rather than hidden, per RFC 0002 §12.2 — an interface that
 * is told nothing about staleness will present old values as current.
 *
 * Absent when the build has no live home, which is every preview build.
 */
export interface HomeState {
  readonly values: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly stale: boolean;
}

export interface TrustedHostSnapshot {
  /** Whether the trusted identity boundary currently has a signed-in user. */
  readonly authenticated: boolean;
  /** Changes on identity transitions or explicit reconnection; never exposes a UID. */
  readonly authorizationEpoch?: number;
  readonly homeState?: HomeState;
  readonly activeHome: HomeSummary;
  readonly homes: readonly HomeSummary[];
  readonly connection: HomeConnectionStatus;
  readonly preview: boolean;
  readonly signInAvailable: boolean;
  /** Trusted popup lifecycle; never includes provider errors or identity details. */
  readonly signInStatus?: 'idle' | 'pending' | 'failed';
}

export interface HouseCallOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface TrustedHost {
  readonly getSnapshot: () => TrustedHostSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Forwards a named coordinator call on behalf of the home's own interface.
   * Rejects with `HouseCallError` using the closed bridge vocabulary. The
   * coordinator, not this method, decides whether the resident may make it.
   * Absent on hosts that cannot reach a coordinator.
   */
  readonly call?: (name: string, args: unknown, options: HouseCallOptions) => Promise<unknown>;
  /** Account-owned shell preferences only; never forwarded to a house runtime. */
  readonly getPreferencesScope?: () => string | undefined;
  /** Restarts a failed connection only; never replays house calls. */
  readonly reconnect?: () => void;
  readonly signIn?: () => void;
  /** Signs out the trusted identity; never exposed to a house runtime. */
  readonly signOut?: () => Promise<void>;
  readonly dispose: () => void;
}
