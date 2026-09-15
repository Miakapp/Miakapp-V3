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
  emit(signedIn: boolean): void;
} {
  let signedIn = initiallySignedIn;
  const listeners = new Set<(value: boolean) => void>();
  return {
    isSignedIn: () => signedIn,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async () => undefined),
    getFirebaseIdToken: vi.fn(async () => 'firebase-token'),
    getAppCheckToken: vi.fn(async () => 'app-check-token'),
    dispose: vi.fn(),
    emit(value) {
      signedIn = value;
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
