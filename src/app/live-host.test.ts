import type {
  BrowserClient,
  BrowserLifecycleEvent,
  BrowserStateSnapshot,
} from './miakapi-browser';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UiNode } from '../../component-runtime/src/contract';
import { createLiveHost, type LiveIdentity } from './live-host';

type CallHandle = ReturnType<BrowserClient['calls']['start']>;

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nodeById(tree: UiNode, id: string): UiNode {
  if (tree.id === id) return tree;
  for (const child of tree.children ?? []) {
    if (child.id === id) return child;
    const nested = nodeByIdOrUndefined(child, id);
    if (nested !== undefined) return nested;
  }
  throw new Error(`Missing UI node ${id}`);
}

function nodeByIdOrUndefined(tree: UiNode, id: string): UiNode | undefined {
  if (tree.id === id) return tree;
  for (const child of tree.children ?? []) {
    const nested = nodeByIdOrUndefined(child, id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function fakeIdentity(initiallySignedIn: boolean): LiveIdentity & {
  emit(signedIn: boolean, userId?: string): void;
} {
  let signedIn = initiallySignedIn;
  let userId = signedIn ? 'resident-a' : null;
  const listeners = new Set<(value: boolean) => void>();
  return {
    isSignedIn: () => signedIn,
    getUserId: () => userId,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async () => undefined),
    getFirebaseIdToken: vi.fn(async () => 'firebase-token'),
    getAppCheckToken: vi.fn(async () => 'app-check-token'),
    dispose: vi.fn(),
    emit(value, nextUserId = 'resident-a') {
      signedIn = value;
      userId = value ? nextUserId : null;
      for (const listener of listeners) listener(value);
    },
  };
}

function fakeClient(call: CallHandle = {
  localId: 'call-1',
  accepted: Promise.resolve(),
  result: Promise.resolve(null),
  cancel: vi.fn(),
}): BrowserClient & {
  emitLifecycle(event: BrowserLifecycleEvent): void;
  emitState(snapshot: BrowserStateSnapshot): void;
} {
  const lifecycleListeners = new Set<(event: BrowserLifecycleEvent) => void>();
  const stateListeners = new Set<(snapshot: BrowserStateSnapshot) => void>();
  return {
    status: 'idle',
    home: {
      snapshot: () => undefined,
      subscribe: () => () => undefined,
    },
    state: {
      snapshot: () => undefined,
      subscribe(listener) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
    },
    calls: {
      start: vi.fn(() => call),
    },
    errors: {
      subscribe: () => () => undefined,
    },
    start: vi.fn(async () => ({
      sessionId: 1,
      connectedAtMs: 1,
      enrolled: true,
      coordinators: [],
    })),
    stop: vi.fn(async () => undefined),
    subscribe(listener) {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    emitLifecycle(event) {
      for (const listener of lifecycleListeners) listener(event);
    },
    emitState(snapshot) {
      for (const listener of stateListeners) listener(snapshot);
    },
  };
}

function hostWith(identity: LiveIdentity, clients: BrowserClient[]) {
  return createLiveHost({
    exchangeEndpoint: 'https://control.example.test/v1/user-relay-tokens:exchange',
    home: {
      id: 'synthetic-home',
      name: 'Synthetic home',
      detail: 'Staging',
      accent: '#b8d9ff',
    },
    identity,
  }, {
    createCredentialProvider: () => ({
      getCredential: vi.fn(async () => ({
        relayUrl: 'wss://relay.example.test/ws',
        accessToken: 'relay-token',
        expiresAtMs: Date.now() + 60_000,
      })),
    }),
    createClient: () => clients.shift()!,
  });
}

describe('live trusted host', () => {
  it('drops the old relay and private state on a direct account switch', async () => {
    const identity = fakeIdentity(true);
    const first = fakeClient();
    const second = fakeClient();
    const stop = deferred<void>();
    vi.mocked(first.stop).mockReturnValue(stop.promise);
    const host = hostWith(identity, [first, second]);
    first.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    first.emitState({ epoch: new Uint8Array(16), revision: 1, stale: false,
      values: { 'zone.private': 'resident-a-only' } });
    const before = host.getSnapshot();
    identity.emit(true, 'resident-b');
    expect(first.stop).toHaveBeenCalledOnce();
    expect(host.getSnapshot().homeState).toBeUndefined();
    expect(host.getSnapshot().authenticated).toBe(true);
    expect(host.getSnapshot().authorizationEpoch).not.toBe(before.authorizationEpoch);
    expect(second.start).toHaveBeenCalledOnce();
    first.emitState({ epoch: new Uint8Array(16), revision: 2, stale: false,
      values: { 'zone.private': 'late-a' } });
    expect(host.getSnapshot().homeState).toBeUndefined();
    await expect(host.call?.('lighting.toggle', null, { timeoutMs: 1000,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'unavailable' });
    stop.resolve();
    await stop.promise;
    second.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    expect(host.getSnapshot().connection).toBe('ready');
    host.dispose();
  });

  it('rejects retired credential providers and late call results after switching accounts', async () => {
    const identity = fakeIdentity(true);
    const pending = deferred<unknown>();
    const first = fakeClient({ localId: 'call-old', accepted: Promise.resolve(), result: pending.promise, cancel: vi.fn() });
    const second = fakeClient();
    const clients = [first, second];
    const captured: import('./miakapi-browser').BrowserRelayCredentialProvider[] = [];
    const createProvider = vi.fn(() => ({ getCredential: vi.fn(async () => ({ relayUrl: 'wss://relay.example.test/ws', accessToken: 'synthetic', expiresAtMs: Date.now() + 60000 })) }));
    const host = createLiveHost({ exchangeEndpoint: 'https://control.example.test/exchange',
      home: { id: 'synthetic-home', name: 'Synthetic', detail: '', accent: '#fff' }, identity }, {
      createCredentialProvider: createProvider,
      createClient: (options) => { captured.push(options.credentialProvider); return clients.shift()!; },
    });
    first.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    const call = host.call!('lighting.toggle', null, { timeoutMs: 1000, signal: new AbortController().signal });
    identity.emit(true, 'resident-b');
    identity.emit(true, 'resident-b');
    expect(createProvider).toHaveBeenCalledTimes(2);
    expect(second.start).toHaveBeenCalledOnce();
    pending.resolve('old-private-result');
    await expect(call).rejects.toMatchObject({ code: 'denied' });
    await expect(captured[0]!.getCredential({ homeId: 'synthetic-home', reason: 'initial', signal: new AbortController().signal })).rejects.toThrow('Identity changed');
    host.dispose();
  });

  it('keeps relay creation behind an explicit Firebase sign-in', () => {
    const identity = fakeIdentity(false);
    const host = hostWith(identity, []);

    expect(host.getSnapshot().signInAvailable).toBe(true);
    expect(host.getSnapshot().connectionDetail).toBe('Sign in required');

    host.signIn?.();

    expect(identity.signIn).toHaveBeenCalledOnce();
    host.dispose();
  });

  it('renders live relay state and dispatches one non-retried coordinator call', async () => {
    const identity = fakeIdentity(true);
    const client = fakeClient();
    const host = hostWith(identity, [client]);
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    client.emitState({
      epoch: new Uint8Array(16),
      revision: 1,
      stale: false,
      values: {
        'zone.alpha.light.on': true,
        'climate.zone_gamma.temperature': 19.5,
        'service.coordinator.health': 'healthy',
      },
    });

    expect(host.getSnapshot().connection).toBe('ready');
    expect(host.getSnapshot().uiTree).toMatchObject({ id: 'live-home', type: 'screen' });

    host.interact({ event: 'press', handler: 'lighting.toggle' });
    expect(client.calls.start).toHaveBeenCalledWith(expect.objectContaining({
      function: 'lighting.toggle',
      arguments: null,
      timeoutMs: 10_000,
    }));
    await waitFor(() => {
      expect(host.getSnapshot().activity[0]?.title).toBe('Light toggled');
      expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
        .toBe('applied');
    });
    host.dispose();
  });

  it('keeps pending, accepted and applied distinct while blocking a duplicate action', async () => {
    const accepted = deferred<void>();
    const result = deferred<unknown>();
    const client = fakeClient({
      localId: 'call-1',
      accepted: accepted.promise,
      result: result.promise,
      cancel: vi.fn(),
    });
    const host = hostWith(fakeIdentity(true), [client]);
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });

    host.interact({ event: 'press', handler: 'lighting.toggle' });
    expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
      .toBe('pending');

    accepted.resolve(undefined);
    await waitFor(() => {
      expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
        .toBe('accepted');
    });

    host.interact({ event: 'press', handler: 'lighting.toggle' });
    expect(client.calls.start).toHaveBeenCalledOnce();

    result.resolve(null);
    await waitFor(() => {
      expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
        .toBe('applied');
    });
    host.dispose();
  });

  it.each([
    ['failed', new Error('coordinator rejected the call')],
    ['outcome_unknown', { outcome: 'outcome_unknown' }],
  ] as const)('renders a terminal %s without retrying', async (expectedState, failure) => {
    const result = deferred<unknown>();
    const client = fakeClient({
      localId: 'call-1',
      accepted: Promise.resolve(),
      result: result.promise,
      cancel: vi.fn(),
    });
    const host = hostWith(fakeIdentity(true), [client]);
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });

    host.interact({ event: 'press', handler: 'lighting.toggle' });
    result.reject(failure);

    await waitFor(() => {
      expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
        .toBe(expectedState);
    });
    expect(client.calls.start).toHaveBeenCalledOnce();
    host.dispose();
  });

  it('marks stale relay state and disables the physical control', () => {
    const client = fakeClient();
    const host = hostWith(fakeIdentity(true), [client]);
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    client.emitState({
      epoch: new Uint8Array(16),
      revision: 2,
      stale: true,
      values: { 'zone.alpha.light.on': true },
    });

    expect(nodeById(host.getSnapshot().uiTree, 'live-state-freshness').props.state)
      .toBe('stale');
    expect(nodeById(host.getSnapshot().uiTree, 'live-light-toggle').props.disabled)
      .toBe(true);
    host.interact({ event: 'press', handler: 'lighting.toggle' });
    expect(client.calls.start).not.toHaveBeenCalled();
    host.dispose();
  });

  it('ignores a late call settlement after sign-out', async () => {
    const result = deferred<unknown>();
    const identity = fakeIdentity(true);
    const client = fakeClient({
      localId: 'call-1',
      accepted: Promise.resolve(),
      result: result.promise,
      cancel: vi.fn(),
    });
    const host = hostWith(identity, [client]);
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    host.interact({ event: 'press', handler: 'lighting.toggle' });

    identity.emit(false);
    result.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(nodeById(host.getSnapshot().uiTree, 'live-light-action-status').props.state)
      .toBe('idle');
    expect(host.getSnapshot().activity).toHaveLength(0);
    host.dispose();
  });

  it('discards the browser client on sign-out and creates a fresh one on sign-in', async () => {
    const identity = fakeIdentity(true);
    const first = fakeClient();
    const second = fakeClient();
    const host = hostWith(identity, [first, second]);

    identity.emit(false);
    await Promise.resolve();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(host.getSnapshot().signInAvailable).toBe(true);

    identity.emit(true);
    await Promise.resolve();
    expect(second.start).toHaveBeenCalledOnce();
    host.dispose();
  });
});

describe('live trusted host — calls from a home’s own interface', () => {
  const ready = (client: ReturnType<typeof fakeClient>, stale = false): void => {
    client.emitLifecycle({ previous: 'synchronizing', current: 'ready' });
    client.emitState({ epoch: new Uint8Array(16), revision: 1, stale, values: {} });
  };
  const options = () => ({ timeoutMs: 5_000, signal: new AbortController().signal });

  it('forwards the named call once, with its arguments, and returns the coordinator result', async () => {
    const client = fakeClient({
      localId: 'call-1',
      accepted: Promise.resolve(),
      result: Promise.resolve({ applied: true }),
      cancel: vi.fn(),
    });
    const host = hostWith(fakeIdentity(true), [client]);
    ready(client);

    await expect(host.call!('heating.set', { target: 20 }, options())).resolves.toEqual({ applied: true });
    expect(client.calls.start).toHaveBeenCalledOnce();
    expect(client.calls.start).toHaveBeenCalledWith(expect.objectContaining({
      function: 'heating.set',
      arguments: { target: 20 },
      timeoutMs: 5_000,
    }));
    host.dispose();
  });

  it('refuses before dispatch when the home is stale or offline', async () => {
    const staleClient = fakeClient();
    const stale = hostWith(fakeIdentity(true), [staleClient]);
    ready(staleClient, true);
    await expect(stale.call!('heating.set', null, options())).rejects.toMatchObject({ code: 'unavailable' });

    const offline = hostWith(fakeIdentity(false), []);
    await expect(offline.call!('heating.set', null, options())).rejects.toMatchObject({ code: 'unavailable' });
    for (const host of [stale, offline]) host.dispose();
  });

  it('says the outcome is unknown instead of retrying or calling it failed', async () => {
    const client = fakeClient({
      localId: 'call-1',
      accepted: Promise.resolve(),
      result: Promise.reject(Object.assign(new Error('lost'), { outcome: 'outcome_unknown' })),
      cancel: vi.fn(),
    });
    const host = hostWith(fakeIdentity(true), [client]);
    ready(client);
    await expect(host.call!('heating.set', null, options())).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(client.calls.start).toHaveBeenCalledOnce();
    host.dispose();
  });
});
