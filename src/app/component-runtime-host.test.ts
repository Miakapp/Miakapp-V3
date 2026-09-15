import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROKER_PROTOCOL,
  COMPONENT_ABI,
  type CapabilityRequirements,
  type ComponentPointerV1,
} from '../../component-runtime/src/contract';
import {
  DENY_ALL_CAPABILITIES,
  assertSandboxOrigin,
  intersectCapabilities,
  mountComponentRuntime,
  type ComponentRuntimeSession,
  type RuntimeFailure,
  type RuntimeLifecycle,
} from './component-runtime-host';

const HOST_ORIGIN = 'https://app.miakapp.test';
const SANDBOX_ORIGIN = 'https://sandbox.miakapp.test';
const INSTANCE = 'instance0000000000';
const NONCE = 'nonce00000000000000';

const REQUIRES: CapabilityRequirements = {
  state_read: ['global.temperature'],
  event_subscribe: ['alarm.changed'],
  event_publish: ['ui.preference.changed'],
  call: ['lighting.set'],
  presentation: ['media.front_door'],
};

function pointer(overrides: Partial<ComponentPointerV1> = {}): ComponentPointerV1 {
  return {
    schema: 'miakapp.component-pointer/1',
    home_id: 'home-1',
    generation: 7,
    release: 'r-7',
    abi: COMPONENT_ABI,
    url: 'https://artifacts.miakapp.test/r-7.js',
    sha256: 'A'.repeat(43),
    size: 12,
    requires: REQUIRES,
    ...overrides,
  } as ComponentPointerV1;
}

interface Harness {
  readonly frames: HTMLIFrameElement[];
  readonly posted: Array<{ data: unknown; transfer: Transferable[] }>;
  readonly lifecycles: Array<{ lifecycle: RuntimeLifecycle; failure?: RuntimeFailure }>;
  readonly trees: Array<{ tree: unknown; revision: number }>;
  readonly window: Window;
  announce(options?: { nonce?: string; origin?: string; source?: unknown }): void;
  brokerPort(): MessagePort;
}

function createHarness(): Harness {
  const frames: HTMLIFrameElement[] = [];
  const posted: Array<{ data: unknown; transfer: Transferable[] }> = [];
  const lifecycles: Array<{ lifecycle: RuntimeLifecycle; failure?: RuntimeFailure }> = [];
  const trees: Array<{ tree: unknown; revision: number }> = [];
  const listeners = new Set<(event: MessageEvent) => void>();

  const contentWindow = {
    postMessage: (data: unknown, _targetOrigin: string, transfer: Transferable[] = []) => {
      posted.push({ data, transfer });
    },
  };

  const hostWindow = {
    location: { origin: HOST_ORIGIN },
    document: {
      body: document.body,
      createElement: (tag: string) => {
        const element = document.createElement(tag) as HTMLIFrameElement;
        Object.defineProperty(element, 'contentWindow', {
          value: contentWindow,
          configurable: true,
        });
        frames.push(element);
        return element;
      },
    },
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.delete(listener);
    },
  } as unknown as Window;

  return {
    frames,
    posted,
    lifecycles,
    trees,
    window: hostWindow,
    announce(options = {}) {
      const event = {
        data: {
          type: 'miakapp.runtime.ready',
          runtime: '1',
          nonce: options.nonce ?? NONCE,
        },
        origin: options.origin ?? 'null',
        source: 'source' in options ? options.source : contentWindow,
        ports: [],
      } as unknown as MessageEvent;
      for (const listener of [...listeners]) listener(event);
    },
    brokerPort() {
      const bind = posted.at(-1);
      if (!bind) throw new Error('no bind message was posted');
      return bind.transfer[0] as MessagePort;
    },
  };
}

let ids = 0;

function mount(harness: Harness, options: Record<string, unknown> = {}): Promise<ComponentRuntimeSession> {
  ids = 0;
  return mountComponentRuntime(
    { pointer: pointer(), artifact: { bytes: new Uint8Array([1, 2, 3]) } },
    {
      sandboxOrigin: SANDBOX_ORIGIN,
      onTree: (tree, revision) => harness.trees.push({ tree, revision }),
      onLifecycle: (lifecycle, failure) => harness.lifecycles.push({ lifecycle, ...(failure ? { failure } : {}) }),
      window: harness.window,
      container: document.body,
      randomId: () => {
        ids += 1;
        return ids === 1 ? INSTANCE : NONCE;
      },
      ...options,
    },
  );
}

/** Drives the broker half of the bridge over the real transferred port. */
class BrokerDouble {
  private seq = 1;
  readonly received: Array<Record<string, unknown>> = [];

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event) => {
      this.received.push(event.data as Record<string, unknown>);
    });
    port.start();
  }

  send(kind: string, payload: unknown): void {
    this.port.postMessage({
      v: BROKER_PROTOCOL,
      instance: INSTANCE,
      epoch: 1,
      seq: this.seq,
      kind,
      payload,
    });
    this.seq += 1;
  }

  kinds(): string[] {
    return this.received.map((envelope) => String(envelope.kind));
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('assertSandboxOrigin', () => {
  it('accepts a bare HTTPS origin that is not the host origin', () => {
    expect(assertSandboxOrigin(SANDBOX_ORIGIN, HOST_ORIGIN)).toBe(SANDBOX_ORIGIN);
  });

  it('refuses a plaintext origin', () => {
    expect(() => assertSandboxOrigin('http://sandbox.miakapp.test', HOST_ORIGIN))
      .toThrow(/HTTPS/u);
  });

  it('refuses an origin carrying a path', () => {
    expect(() => assertSandboxOrigin('https://sandbox.miakapp.test/runtime', HOST_ORIGIN))
      .toThrow(/no path/u);
  });

  it('refuses the host origin itself', () => {
    expect(() => assertSandboxOrigin(HOST_ORIGIN, HOST_ORIGIN))
      .toThrow(/differ from the host origin/u);
  });
});

describe('intersectCapabilities', () => {
  it('grants nothing under the default deny-all policy', () => {
    expect(intersectCapabilities(REQUIRES, DENY_ALL_CAPABILITIES)).toEqual({
      state_read: [],
      event_subscribe: [],
      event_publish: [],
      call: [],
      presentation: [],
    });
  });

  it('never grants beyond what the release declared', () => {
    const grant = intersectCapabilities(REQUIRES, {
      state_read: ['global.*'],
      event_subscribe: ['alarm.changed', 'lock.changed'],
      event_publish: [],
      call: ['lighting.set'],
      presentation: ['media.front_door'],
    });
    expect(grant.state_read).toEqual(['global.temperature']);
    expect(grant.event_subscribe).toEqual(['alarm.changed']);
    expect(grant.event_publish).toEqual([]);
  });

  it('never grants beyond what the deployment allows', () => {
    const grant = intersectCapabilities(REQUIRES, {
      ...DENY_ALL_CAPABILITIES,
      state_read: ['global.*'],
    });
    expect(grant.state_read).toEqual(['global.temperature']);
    expect(grant.call).toEqual([]);
  });
});

describe('mountComponentRuntime', () => {
  it('creates a confined frame pointed at the declared sandbox origin', async () => {
    const harness = createHarness();
    const mounted = mount(harness);
    const frame = harness.frames[0]!;

    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.hidden).toBe(true);
    expect(frame.src).toBe(`${SANDBOX_ORIGIN}/sandbox.html#nonce=${NONCE}`);

    harness.announce();
    await mounted;
  });

  it('refuses to bind a frame that does not report an opaque origin', async () => {
    const harness = createHarness();
    const mounted = mount(harness);
    harness.announce({ origin: SANDBOX_ORIGIN });

    await expect(mounted).rejects.toThrow(/opaque origin/u);
    expect(harness.posted).toHaveLength(0);
    expect(harness.lifecycles.at(-1)?.failure?.code).toBe('sandbox_origin_invalid');
  });

  it('ignores a readiness announcement carrying another nonce', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const mounted = mount(harness, { readyTimeoutMs: 1_000 });
    const rejected = expect(mounted).rejects.toThrow(/did not announce readiness/u);

    harness.announce({ nonce: 'someone-elses-nonce' });
    expect(harness.posted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it('ignores a readiness announcement from another window', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const mounted = mount(harness, { readyTimeoutMs: 1_000 });
    const rejected = expect(mounted).rejects.toThrow(/did not announce readiness/u);

    harness.announce({ source: { postMessage: () => {} } });
    expect(harness.posted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it('loads, renders and activates a verified release', async () => {
    const harness = createHarness();
    const mounted = mount(harness, { policy: REQUIRES, staging: true });
    harness.announce();
    const session = await mounted;

    const bind = harness.posted.at(-1)!.data as Record<string, unknown>;
    expect(bind.type).toBe('miakapp.runtime.bind');
    expect(bind.nonce).toBe(NONCE);
    expect(bind.instance).toBe(INSTANCE);

    const broker = new BrokerDouble(harness.brokerPort());
    broker.send('runtime.bound', {});
    await settle();

    const load = broker.received.find((envelope) => envelope.kind === 'runtime.load');
    expect(load).toBeDefined();
    const loadPayload = load!.payload as Record<string, unknown>;
    expect(loadPayload.grant).toEqual(REQUIRES);
    expect((loadPayload.release as Record<string, unknown>).sha256).toBe('A'.repeat(43));
    expect((loadPayload.artifact as ArrayBuffer).byteLength).toBe(3);

    broker.send('runtime.worker_ready', {});
    await settle();
    expect(session.lifecycle).toBe('staging');

    const tree = { id: 'root', type: 'screen', props: { title: 'Home' }, children: [] };
    broker.send('ui.render', { render_revision: 1, tree });
    await settle();
    expect(harness.trees).toEqual([{ tree, revision: 1 }]);
    expect(broker.kinds()).toContain('runtime.activate');

    broker.send('runtime.active', {});
    await settle();
    expect(session.lifecycle).toBe('active');

    session.interact('button-1', 'press');
    await settle();
    const interaction = broker.received.at(-1)!;
    expect(interaction.kind).toBe('ui.interaction');
    expect(interaction.payload).toEqual({ render_revision: 1, node_id: 'button-1', event: 'press' });
  });

  it('refuses a render revision that is not the next one', async () => {
    const harness = createHarness();
    const mounted = mount(harness);
    harness.announce();
    await mounted;

    const broker = new BrokerDouble(harness.brokerPort());
    broker.send('runtime.bound', {});
    broker.send('runtime.worker_ready', {});
    broker.send('ui.render', { render_revision: 4, tree: { id: 'root', type: 'screen', props: {}, children: [] } });
    await settle();

    expect(harness.trees).toHaveLength(0);
    expect(harness.lifecycles.at(-1)).toEqual({
      lifecycle: 'failed',
      failure: { code: 'render_invalid', message: 'host render revision is invalid' },
    });
  });

  it('denies a call the host has no broker for', async () => {
    const harness = createHarness();
    const mounted = mount(harness, { policy: REQUIRES });
    harness.announce();
    const session = await mounted;

    const broker = new BrokerDouble(harness.brokerPort());
    broker.send('runtime.bound', {});
    broker.send('runtime.worker_ready', {});
    broker.send('call.start', { operation_id: 1, name: 'lighting.set', argument: {} });
    await settle();

    expect(harness.lifecycles.at(-1)?.failure?.code).toBe('capability_denied');
    expect(session.lifecycle).toBe('failed');
  });

  it('reports a broker failure and tears the frame down', async () => {
    const harness = createHarness();
    const mounted = mount(harness);
    harness.announce();
    await mounted;
    expect(document.body.contains(harness.frames[0]!)).toBe(true);

    const broker = new BrokerDouble(harness.brokerPort());
    broker.send('runtime.bound', {});
    broker.send('runtime.error', { code: 'artifact_hash_mismatch', message: 'bad bytes' });
    await settle();

    expect(harness.lifecycles.at(-1)).toEqual({
      lifecycle: 'failed',
      failure: { code: 'artifact_hash_mismatch', message: 'bad bytes' },
    });
    expect(document.body.contains(harness.frames[0]!)).toBe(false);
  });

  it('disposes once and removes the frame', async () => {
    const harness = createHarness();
    const mounted = mount(harness);
    harness.announce();
    const session = await mounted;

    const broker = new BrokerDouble(harness.brokerPort());
    broker.send('runtime.bound', {});
    await settle();

    session.dispose();
    session.dispose();
    await settle();

    expect(broker.kinds().filter((kind) => kind === 'runtime.dispose')).toHaveLength(1);
    expect(harness.lifecycles.filter((entry) => entry.lifecycle === 'terminated')).toHaveLength(1);
    expect(document.body.contains(harness.frames[0]!)).toBe(false);
  });
});
