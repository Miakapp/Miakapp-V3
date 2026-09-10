import {
  createBrowserClient,
  createControlPlaneBrowserRelayCredentialProvider,
  type BrowserClient,
  type BrowserClientFactory,
  type BrowserClientStatus,
  type BrowserRelayCredentialProvider,
  type BrowserRelayCredentialRequest,
} from './miakapi-browser';

import type {
  HomeActivity,
  HomeConnectionStatus,
  HomeSummary,
  SemanticInteraction,
  TrustedHost,
  TrustedHostSnapshot,
} from './host';
import { createLiveTree } from './live-tree';

export interface LiveIdentity {
  readonly isSignedIn: () => boolean;
  readonly subscribe: (listener: (signedIn: boolean) => void) => () => void;
  readonly signIn: () => Promise<void>;
  readonly getFirebaseIdToken: (request: BrowserRelayCredentialRequest) => Promise<string>;
  readonly getAppCheckToken: (request: BrowserRelayCredentialRequest) => Promise<string>;
  readonly dispose: () => void;
}

export interface LiveHostOptions {
  readonly home: HomeSummary;
  readonly exchangeEndpoint: string;
  readonly identity: LiveIdentity;
}

export interface LiveHostDependencies {
  readonly createClient?: BrowserClientFactory;
  readonly createCredentialProvider?: (
    options: Parameters<typeof createControlPlaneBrowserRelayCredentialProvider>[0],
  ) => BrowserRelayCredentialProvider;
}

type LiveState = NonNullable<ReturnType<BrowserClient['state']['snapshot']>>['values'];

const EMPTY_STATE: LiveState = Object.freeze({});
const EMPTY_ACTIVITY: readonly HomeActivity[] = Object.freeze([]);

function connectionFrom(status: BrowserClientStatus): HomeConnectionStatus {
  if (status === 'ready') return 'ready';
  if (status === 'reconnecting') return 'reconnecting';
  if (status === 'connecting' || status === 'authenticating' || status === 'synchronizing') {
    return 'connecting';
  }
  return 'unavailable';
}

function connectionDetail(status: BrowserClientStatus, signedIn: boolean): string {
  if (!signedIn) return 'Sign in required';
  if (status === 'ready') return 'Live relay connected';
  if (status === 'reconnecting') return 'Reconnecting safely';
  if (status === 'authenticating') return 'Authenticating relay';
  if (status === 'synchronizing') return 'Synchronizing home';
  if (status === 'connecting') return 'Connecting to relay';
  return 'Live home unavailable';
}

class LiveTrustedHost implements TrustedHost {
  readonly #listeners = new Set<() => void>();
  readonly #identity: LiveIdentity;
  readonly #home: HomeSummary;
  readonly #createClient: BrowserClientFactory;
  readonly #credentialProvider: BrowserRelayCredentialProvider;
  readonly #removeIdentityListener: () => void;

  #client: BrowserClient | undefined;
  #removeClientListeners: Array<() => void> = [];
  #signedIn: boolean;
  #status: BrowserClientStatus = 'idle';
  #state: LiveState = EMPTY_STATE;
  #activity: readonly HomeActivity[] = EMPTY_ACTIVITY;
  #pendingAction = false;
  #disposed = false;
  #connectionGeneration = 0;
  #snapshot: TrustedHostSnapshot;

  constructor(options: LiveHostOptions, dependencies: LiveHostDependencies) {
    this.#identity = options.identity;
    this.#home = options.home;
    this.#signedIn = options.identity.isSignedIn();
    const createCredentialProvider = dependencies.createCredentialProvider
      ?? createControlPlaneBrowserRelayCredentialProvider;
    this.#credentialProvider = createCredentialProvider({
      exchangeEndpoint: options.exchangeEndpoint,
      getFirebaseIdToken: options.identity.getFirebaseIdToken,
      getAppCheckToken: options.identity.getAppCheckToken,
    });
    this.#createClient = dependencies.createClient ?? createBrowserClient;
    this.#snapshot = this.#buildSnapshot();
    this.#removeIdentityListener = this.#identity.subscribe((signedIn) => {
      if (this.#disposed || signedIn === this.#signedIn) return;
      this.#signedIn = signedIn;
      if (signedIn) void this.#connect();
      else void this.#disconnect();
      this.#publish();
    });
    if (this.#signedIn) void this.#connect();
  }

  readonly getSnapshot = (): TrustedHostSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly signIn = (): void => {
    if (this.#disposed || this.#signedIn) return;
    void this.#identity.signIn().catch(() => {
      this.#record('Sign-in did not complete', 'The live home remains disconnected.', 'security');
      this.#publish();
    });
  };

  readonly interact = (interaction: SemanticInteraction): void => {
    if (
      this.#disposed
      || this.#status !== 'ready'
      || this.#pendingAction
      || interaction.handler !== 'lighting.toggle'
      || interaction.event !== 'press'
    ) return;

    const client = this.#client;
    if (client === undefined) return;
    this.#pendingAction = true;
    this.#publish();
    const call = client.calls.start({
      function: 'lighting.toggle',
      arguments: null,
      timeoutMs: 10_000,
      idempotencyKey: crypto.randomUUID(),
    });
    void call.result.then(() => {
      this.#record('Light toggled', 'The Bun coordinator confirmed the action.', 'home');
    }).catch((failure: unknown) => {
      const outcomeUnknown = typeof failure === 'object'
        && failure !== null
        && 'outcome' in failure
        && failure.outcome === 'outcome_unknown';
      this.#record(
        outcomeUnknown ? 'Light state needs confirmation' : 'Light action failed',
        outcomeUnknown
          ? 'The effect may have happened; Miakapp did not retry it.'
          : 'The coordinator did not apply the requested action.',
        'security',
      );
    }).finally(() => {
      this.#pendingAction = false;
      this.#publish();
    });
  };

  readonly dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#connectionGeneration += 1;
    this.#removeIdentityListener();
    for (const remove of this.#removeClientListeners) remove();
    this.#removeClientListeners = [];
    this.#listeners.clear();
    void this.#client?.stop({ deadlineMs: 2_000 }).catch(() => undefined);
    this.#client = undefined;
    this.#identity.dispose();
  };

  async #connect(): Promise<void> {
    const generation = ++this.#connectionGeneration;
    const client = this.#createClient({
      homeId: this.#home.id,
      credentialProvider: this.#credentialProvider,
    });
    this.#client = client;
    this.#removeClientListeners = [
      client.subscribe((event) => {
        if (this.#client !== client) return;
        this.#status = event.current;
        this.#publish();
      }),
      client.state.subscribe((snapshot) => {
        if (this.#client !== client) return;
        this.#state = snapshot.stale ? EMPTY_STATE : snapshot.values;
        this.#publish();
      }),
      client.errors.subscribe((failure) => {
        if (this.#client !== client) return;
        this.#record(
          failure.outcome === 'outcome_unknown' ? 'Action outcome unknown' : 'Live connection interrupted',
          'The trusted host stopped short of guessing what happened.',
          'security',
        );
        this.#publish();
      }),
    ];
    try {
      await client.start();
    } catch {
      if (this.#disposed || generation !== this.#connectionGeneration || this.#client !== client) {
        return;
      }
      this.#status = 'stopped';
      this.#record('Live home unavailable', 'The connection failed closed.', 'security');
      this.#publish();
    }
  }

  async #disconnect(): Promise<void> {
    ++this.#connectionGeneration;
    const client = this.#client;
    this.#client = undefined;
    for (const remove of this.#removeClientListeners) remove();
    this.#removeClientListeners = [];
    this.#state = EMPTY_STATE;
    this.#status = 'idle';
    try {
      await client?.stop({ deadlineMs: 2_000 });
    } catch {
      // The signed-out boundary is already closed by the missing credential source.
    }
  }

  #record(title: string, detail: string, tone: HomeActivity['tone']): void {
    this.#activity = Object.freeze([
      Object.freeze({
        id: `${Date.now()}-${this.#activity.length}`,
        title,
        detail,
        time: 'Just now',
        tone,
      }),
      ...this.#activity.slice(0, 7),
    ]);
  }

  #buildSnapshot(): TrustedHostSnapshot {
    const connection = connectionFrom(this.#status);
    return Object.freeze({
      activeHome: this.#home,
      homes: Object.freeze([this.#home]),
      connection,
      connectionDetail: connectionDetail(this.#status, this.#signedIn),
      lastSynced: connection === 'ready' ? 'Live state current' : 'No current live state',
      uiTree: createLiveTree({
        connected: connection === 'ready',
        pendingAction: this.#pendingAction,
        state: this.#state,
      }),
      activity: this.#activity,
      preview: false,
      modeLabel: 'Staging',
      noticeTitle: this.#signedIn ? 'Live staging connection' : 'Connect to Miakapp staging',
      noticeDetail: this.#signedIn
        ? 'Firebase identity, App Check, control plane, relay and Bun coordinator.'
        : 'Sign in with Google to open the trusted live path.',
      signInAvailable: !this.#signedIn,
    });
  }

  #publish(): void {
    if (this.#disposed) return;
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) listener();
  }
}

export function createLiveHost(
  options: LiveHostOptions,
  dependencies: LiveHostDependencies = {},
): TrustedHost {
  return new LiveTrustedHost(options, dependencies);
}
