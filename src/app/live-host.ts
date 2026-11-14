import {
  createBrowserClient,
  createControlPlaneBrowserRelayCredentialProvider,
  type BrowserClient,
  type BrowserClientFactory,
  type BrowserClientStatus,
  type BrowserRelayCredentialProvider,
  type BrowserRelayCredentialRequest,
} from './miakapi-browser';

import { HouseCallError } from '../../component-runtime/src/app-host';

import type {
  HomeConnectionStatus,
  HouseCallOptions,
  HomeState,
  HomeSummary,
  TrustedHost,
  TrustedHostSnapshot,
} from './host';
import type { SignInMethod, SignInOutcome } from './sign-in';

export interface LiveIdentity {
  readonly isSignedIn: () => boolean;
  /** Internal identity only; never passed to a house runtime. */
  readonly getUserId: () => string | null;
  /** Notify for every UID transition, including signed-in A → signed-in B. */
  readonly subscribe: (listener: (signedIn: boolean) => void) => () => void;
  readonly signIn: () => Promise<void>;
  readonly signInWith?: (method: SignInMethod) => Promise<SignInOutcome>;
  readonly enablePush?: (homeId: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
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


function connectionFrom(status: BrowserClientStatus): HomeConnectionStatus {
  if (status === 'ready') return 'ready';
  if (status === 'reconnecting') return 'reconnecting';
  if (status === 'connecting' || status === 'authenticating' || status === 'synchronizing') {
    return 'connecting';
  }
  return 'unavailable';
}

class LiveTrustedHost implements TrustedHost {
  readonly #listeners = new Set<() => void>();
  readonly #identity: LiveIdentity;
  readonly #home: HomeSummary;
  readonly #createClient: BrowserClientFactory;
  readonly #createCredentialProvider: () => BrowserRelayCredentialProvider;
  readonly #removeIdentityListener: () => void;

  #client: BrowserClient | undefined;
  #removeClientListeners: Array<() => void> = [];
  #signedIn: boolean;
  #userId: string | null;
  #authorizationEpoch = 0;
  #signInStatus: 'idle' | 'pending' | 'failed' = 'idle';
  #status: BrowserClientStatus = 'idle';
  #stateStale = false;
  /**
   * The home state as the relay reported it. The home's own interface is told
   * the state is old rather than handed an empty home. Undefined until the
   * client has delivered one snapshot.
   */
  #homeState: HomeState | undefined;
  #disposed = false;
  #connectionGeneration = 0;
  #snapshot: TrustedHostSnapshot;

  constructor(options: LiveHostOptions, dependencies: LiveHostDependencies) {
    this.#identity = options.identity;
    this.#home = options.home;
    this.#userId = options.identity.getUserId();
    this.#signedIn = this.#userId !== null;
    const createCredentialProvider = dependencies.createCredentialProvider
      ?? createControlPlaneBrowserRelayCredentialProvider;
    this.#createCredentialProvider = () => {
      const epoch = this.#authorizationEpoch;
      const current = (): void => {
        if (this.#disposed || epoch !== this.#authorizationEpoch
          || this.#identity.getUserId() !== this.#userId || !this.#signedIn) {
          throw new Error('Identity changed');
        }
      };
      const provider = createCredentialProvider({
        exchangeEndpoint: options.exchangeEndpoint,
        getFirebaseIdToken: async (request) => {
          current();
          const token = await options.identity.getFirebaseIdToken(request);
          current();
          return token;
        },
        getAppCheckToken: async (request) => {
          current();
          const token = await options.identity.getAppCheckToken(request);
          current();
          return token;
        },
      });
      return { getCredential: async (request) => {
        current();
        const credential = await provider.getCredential(request);
        current();
        return credential;
      } };
    };
    this.#createClient = dependencies.createClient ?? createBrowserClient;
    this.#snapshot = this.#buildSnapshot();
    this.#removeIdentityListener = this.#identity.subscribe(() => {
      const userId = this.#identity.getUserId();
      if (this.#disposed || userId === this.#userId) return;
      this.#userId = userId;
      this.#signedIn = userId !== null;
      ++this.#authorizationEpoch;
      this.#signInStatus = 'idle';
      // Detach synchronously; an old stop() must not block or overwrite the
      // new account. A fresh provider cannot reuse a prior user's lease.
      void this.#disconnect();
      if (this.#signedIn) void this.#connect();
      this.#publish();
    });
    if (this.#signedIn) void this.#connect();
  }

  readonly getSnapshot = (): TrustedHostSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get signInWith(): TrustedHost['signInWith'] {
    return this.#identity.signInWith;
  }

  get enablePush(): TrustedHost['enablePush'] {
    const enable = this.#identity.enablePush;
    return enable === undefined ? undefined : async () => await enable(this.#home.id);
  }

  readonly signIn = (): void => {
    if (this.#disposed || this.#signedIn || this.#signInStatus === 'pending') return;
    const epoch = this.#authorizationEpoch;
    this.#signInStatus = 'pending';
    this.#publish();
    // Keep the popup call in the click's synchronous stack for browser gesture
    // requirements. A retired attempt cannot annotate the next identity.
    void (async () => {
      try {
        await this.#identity.signIn();
        if (this.#disposed || epoch !== this.#authorizationEpoch) return;
        this.#signInStatus = 'idle';
      } catch {
        if (this.#disposed || epoch !== this.#authorizationEpoch) return;
        this.#signInStatus = 'failed';
      }
      this.#publish();
    })();
  };

  readonly reconnect = (): void => {
    if (this.#disposed || !this.#signedIn || connectionFrom(this.#status) !== 'unavailable') return;
    // Retire credentials, pending release loads and state before trying again.
    // Detach synchronously: a slow stop must not block the replacement client.
    ++this.#authorizationEpoch;
    void this.#disconnect();
    void this.#connect();
  };

  readonly signOut = async (): Promise<void> => {
    if (this.#disposed || !this.#signedIn) return;
    // Auth notification owns teardown, including every other signed-in tab.
    // Propagate failure so the trusted shell never reports a false sign-out.
    await this.#identity.signOut();
  };

  /**
   * The home's own interface asks; the coordinator decides. Nothing here is
   * retried: a call that may have reached the home is reported as such and left
   * for the next state snapshot to settle.
   */
  readonly call = async (name: string, args: unknown, options: HouseCallOptions): Promise<unknown> => {
    if (this.#disposed) throw new HouseCallError('denied');
    const client = this.#client;
    if (client === undefined || this.#status !== 'ready' || this.#stateStale) {
      throw new HouseCallError('unavailable');
    }
    let call: ReturnType<BrowserClient['calls']['start']>;
    try {
      call = client.calls.start({
        function: name,
        arguments: args ?? null,
        timeoutMs: options.timeoutMs,
        idempotencyKey: crypto.randomUUID(),
        signal: options.signal,
      });
    } catch {
      throw new HouseCallError('unavailable');
    }
    try {
      const result = await call.result;
      if (this.#disposed || this.#client !== client) throw new HouseCallError('denied');
      return result;
    } catch (failure) {
      if (this.#disposed || this.#client !== client) throw new HouseCallError('denied');
      const outcome = typeof failure === 'object' && failure !== null && 'outcome' in failure
        ? failure.outcome
        : undefined;
      if (outcome === 'outcome_unknown') throw new HouseCallError('outcome_unknown');
      if (options.signal.aborted) throw new HouseCallError('timeout');
      throw new HouseCallError('failed');
    }
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
      credentialProvider: this.#createCredentialProvider(),
    });
    this.#client = client;
    this.#status = 'connecting';
    this.#publish();
    this.#removeClientListeners = [
      client.subscribe((event) => {
        if (this.#client !== client) return;
        this.#status = event.current;
        this.#publish();
      }),
      client.state.subscribe((snapshot) => {
        if (this.#client !== client) return;
        this.#stateStale = snapshot.stale;
        this.#homeState = Object.freeze({
          values: snapshot.values,
          revision: snapshot.revision,
          stale: snapshot.stale,
        });
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
      this.#publish();
    }
  }

  async #disconnect(): Promise<void> {
    ++this.#connectionGeneration;
    const client = this.#client;
    this.#client = undefined;
    for (const remove of this.#removeClientListeners) remove();
    this.#removeClientListeners = [];
    this.#stateStale = false;
    this.#homeState = undefined;
    this.#status = 'idle';
    try {
      await client?.stop({ deadlineMs: 2_000 });
    } catch {
      // The signed-out boundary is already closed by the missing credential source.
    }
  }

  readonly getPreferencesScope = (): string | undefined => this.#userId === null
    ? undefined
    : `resident:${this.#userId}`;

  #buildSnapshot(): TrustedHostSnapshot {
    const connection = connectionFrom(this.#status);
    return Object.freeze({
      authenticated: this.#signedIn,
      authorizationEpoch: this.#authorizationEpoch,
      ...(this.#homeState === undefined ? {} : { homeState: this.#homeState }),
      activeHome: this.#home,
      homes: Object.freeze([this.#home]),
      connection,
      preview: false,
      signInAvailable: !this.#signedIn,
      signInStatus: this.#signInStatus,
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
