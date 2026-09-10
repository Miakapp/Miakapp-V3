// The staging evidence suite already pins this browser-only MiakAPI bundle by
// digest. Reusing it keeps the web host on that reviewed runtime without
// rewriting the repository-wide dependency lock that historical evidence
// intentionally seals.
// @ts-expect-error The reviewed bundle is generated JavaScript with no sibling declarations.
import * as miakapiBrowserImplementation from '../../infrastructure/staging/browser-relay-page/vendor/miakapi-browser-v4.mjs';

export type BrowserClientStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'synchronizing'
  | 'ready'
  | 'reconnecting'
  | 'draining'
  | 'stopping'
  | 'stopped';

export interface BrowserRelayCredentialRequest {
  readonly homeId: string;
  readonly reason: 'initial' | 'reauth' | 'reconnect';
  readonly signal: AbortSignal;
}

interface BrowserRelayCredential {
  readonly relayUrl: string;
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

export interface BrowserRelayCredentialProvider {
  getCredential(request: BrowserRelayCredentialRequest): Promise<BrowserRelayCredential>;
}

interface BrowserClientOptions {
  readonly homeId: string;
  readonly credentialProvider: BrowserRelayCredentialProvider;
}

interface BrowserReadySession {
  readonly sessionId: number;
  readonly connectedAtMs: number;
  readonly enrolled: boolean;
  readonly coordinators: readonly {
    readonly name: string;
    readonly generation: number;
    readonly status: 'connected' | 'grace';
  }[];
}

export interface BrowserLifecycleEvent {
  readonly previous: BrowserClientStatus;
  readonly current: BrowserClientStatus;
  readonly session?: BrowserReadySession;
}

export interface BrowserStateSnapshot {
  readonly epoch: Uint8Array;
  readonly revision: number;
  readonly values: Readonly<Record<string, unknown>>;
  readonly stale: boolean;
}

export interface BrowserClient {
  readonly status: BrowserClientStatus;
  readonly home: {
    snapshot(): unknown;
    subscribe(listener: (status: unknown) => void): () => void;
  };
  readonly state: {
    snapshot(): BrowserStateSnapshot | undefined;
    subscribe(listener: (snapshot: BrowserStateSnapshot) => void): () => void;
  };
  readonly calls: {
    start(options: {
      readonly function: string;
      readonly arguments: unknown;
      readonly timeoutMs: number;
      readonly idempotencyKey?: string;
      readonly signal?: AbortSignal;
    }): {
      readonly localId: string;
      readonly accepted: Promise<void>;
      readonly result: Promise<unknown>;
      cancel(): void;
    };
  };
  readonly errors: {
    subscribe(listener: (failure: {
      readonly outcome: 'not_dispatched' | 'dispatched' | 'outcome_unknown';
    }) => void): () => void;
  };
  start(): Promise<BrowserReadySession>;
  stop(options?: { readonly deadlineMs?: number }): Promise<void>;
  subscribe(listener: (event: BrowserLifecycleEvent) => void): () => void;
}

export type BrowserClientFactory = (options: BrowserClientOptions) => BrowserClient;

interface CredentialProviderOptions {
  readonly exchangeEndpoint: string;
  readonly getFirebaseIdToken: (request: BrowserRelayCredentialRequest) => Promise<string>;
  readonly getAppCheckToken: (request: BrowserRelayCredentialRequest) => Promise<string>;
}

export const createBrowserClient =
  miakapiBrowserImplementation.createBrowserClient as BrowserClientFactory;
export const createControlPlaneBrowserRelayCredentialProvider =
  miakapiBrowserImplementation.createControlPlaneBrowserRelayCredentialProvider as (
    options: CredentialProviderOptions,
  ) => BrowserRelayCredentialProvider;
