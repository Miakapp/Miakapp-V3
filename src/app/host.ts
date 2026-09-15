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

export interface TrustedHost {
  readonly getSnapshot: () => TrustedHostSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly interact: (interaction: SemanticInteraction) => void;
  readonly signIn?: () => void;
  readonly dispose: () => void;
}
