import type { UiNode } from '../../component-runtime/src/contract';

export type HostView = 'home' | 'activity' | 'settings';

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

export interface HomeActivity {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly tone: 'agent' | 'home' | 'security';
}

/**
 * The home's own state as the trusted host holds it, before any component sees
 * it. `revision` is the relay's, so it is what a consumer orders updates by;
 * `stale` is exposed rather than hidden, per RFC 0002 §12.2 — a component that
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
  /** Changes on identity transitions, without exposing a UID to the UI. */
  readonly authorizationEpoch?: number;
  readonly homeState?: HomeState;
  readonly activeHome: HomeSummary;
  readonly homes: readonly HomeSummary[];
  readonly connection: HomeConnectionStatus;
  readonly connectionDetail: string;
  readonly lastSynced: string;
  readonly uiTree: UiNode;
  readonly activity: readonly HomeActivity[];
  readonly preview: boolean;
  readonly modeLabel: string;
  readonly noticeTitle: string;
  readonly noticeDetail: string;
  readonly signInAvailable: boolean;
}

export interface SemanticInteraction {
  readonly handler: string;
  readonly event: 'press' | 'change';
  readonly value?: string | boolean;
}

export interface HouseCallOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface TrustedHost {
  readonly getSnapshot: () => TrustedHostSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly interact: (interaction: SemanticInteraction) => void;
  /**
   * Forwards a named coordinator call on behalf of the home's own interface.
   * Rejects with `HouseCallError` using the closed bridge vocabulary. The
   * coordinator, not this method, decides whether the resident may make it.
   * Absent on hosts that cannot reach a coordinator.
   */
  readonly call?: (name: string, args: unknown, options: HouseCallOptions) => Promise<unknown>;
  /** Account-owned shell preferences only; never forwarded to a house runtime. */
  readonly getPreferencesScope?: () => string | undefined;
  readonly signIn?: () => void;
  /** Signs out the trusted identity; never exposed to a house runtime. */
  readonly signOut?: () => Promise<void>;
  readonly dispose: () => void;
}
