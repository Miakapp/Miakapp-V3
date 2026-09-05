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

export interface TrustedHostSnapshot {
  readonly activeHome: HomeSummary;
  readonly homes: readonly HomeSummary[];
  readonly connection: HomeConnectionStatus;
  readonly connectionDetail: string;
  readonly lastSynced: string;
  readonly uiTree: UiNode;
  readonly activity: readonly HomeActivity[];
  readonly preview: boolean;
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
  readonly dispose: () => void;
}
