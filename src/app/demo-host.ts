import { createDemoTree, type DemoHomeState } from './demo-tree';
import type {
  HomeActivity,
  HomeSummary,
  SemanticInteraction,
  TrustedHost,
  TrustedHostSnapshot,
} from './host';

const HORIZON: HomeSummary = Object.freeze({
  id: 'home_horizon',
  name: 'Horizon House',
  detail: 'Paris · 8 spaces',
  accent: '#d9ff55',
});

const STUDIO: HomeSummary = Object.freeze({
  id: 'home_studio',
  name: 'Garden Studio',
  detail: 'Offline preview',
  accent: '#ff8d6b',
});

const INITIAL_ACTIVITY: readonly HomeActivity[] = Object.freeze([
  Object.freeze({
    id: 'agent-evening',
    title: 'Evening comfort refined',
    detail: 'Your home agent lowered the hallway brightness after 22:00.',
    time: '12 min ago',
    tone: 'agent',
  }),
  Object.freeze({
    id: 'home-solar',
    title: 'Battery reserve reached',
    detail: 'The home battery crossed the 70% reserve target.',
    time: '38 min ago',
    tone: 'home',
  }),
  Object.freeze({
    id: 'security-entry',
    title: 'Entry secured',
    detail: 'The front door was locked after the last arrival.',
    time: '1 h ago',
    tone: 'security',
  }),
]);

function sceneName(value: DemoHomeState['selectedScene']): string {
  if (value === 'focus') return 'Deep focus';
  if (value === 'away') return 'Everyone away';
  return 'Slow evening';
}

class DemoTrustedHost implements TrustedHost {
  readonly #listeners = new Set<() => void>();

  #state: DemoHomeState = {
    entryLocked: true,
    kitchenLights: false,
    livingRoomLights: true,
    selectedScene: 'evening',
    lastAction: 'Slow evening was last applied at 19:42.',
  };

  #activity: readonly HomeActivity[] = INITIAL_ACTIVITY;

  #snapshot = this.#buildSnapshot();

  readonly getSnapshot = (): TrustedHostSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly interact = (interaction: SemanticInteraction): void => {
    if (
      interaction.handler === 'lighting.living.toggle'
      && typeof interaction.value === 'boolean'
    ) {
      this.#state = { ...this.#state, livingRoomLights: interaction.value };
    } else if (
      interaction.handler === 'lighting.kitchen.toggle'
      && typeof interaction.value === 'boolean'
    ) {
      this.#state = { ...this.#state, kitchenLights: interaction.value };
    } else if (interaction.handler === 'lighting.settle' && interaction.event === 'press') {
      this.#state = {
        ...this.#state,
        kitchenLights: false,
        livingRoomLights: true,
        lastAction: 'Settle in adjusted two preview lights just now.',
      };
      this.#record('Settle in applied', 'Two preview lights were adjusted.', 'home');
    } else if (interaction.handler === 'entry.lock.toggle' && interaction.event === 'press') {
      const entryLocked = !this.#state.entryLocked;
      this.#state = { ...this.#state, entryLocked };
      this.#record(
        entryLocked ? 'Entry locked' : 'Preview entry unlocked',
        'This interaction changed local preview data only.',
        'security',
      );
    } else if (
      interaction.handler === 'scene.select'
      && (
        interaction.value === 'evening'
        || interaction.value === 'focus'
        || interaction.value === 'away'
      )
    ) {
      this.#state = { ...this.#state, selectedScene: interaction.value };
    } else if (interaction.handler === 'scene.apply' && interaction.event === 'press') {
      const selectedScene = sceneName(this.#state.selectedScene);
      this.#state = {
        ...this.#state,
        lastAction: `${selectedScene} was applied in preview just now.`,
      };
      this.#record(
        `${selectedScene} applied`,
        'The semantic call completed in the local preview.',
        'agent',
      );
    } else {
      return;
    }

    this.#publish();
  };

  readonly dispose = (): void => {
    this.#listeners.clear();
  };

  #record(title: string, detail: string, tone: HomeActivity['tone']): void {
    this.#activity = Object.freeze([
      Object.freeze({
        id: `preview-${this.#activity.length}-${title}`,
        title,
        detail,
        time: 'Just now',
        tone,
      }),
      ...this.#activity.slice(0, 7),
    ]);
  }

  #buildSnapshot(): TrustedHostSnapshot {
    return Object.freeze({
      activeHome: HORIZON,
      homes: Object.freeze([HORIZON, STUDIO]),
      connection: 'ready' as const,
      connectionDetail: 'Local preview ready',
      lastSynced: 'Preview state current',
      uiTree: createDemoTree(this.#state),
      activity: this.#activity,
      preview: true,
    });
  }

  #publish(): void {
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) listener();
  }
}

export function createDemoHost(): TrustedHost {
  return new DemoTrustedHost();
}
