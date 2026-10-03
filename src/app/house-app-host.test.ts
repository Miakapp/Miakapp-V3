import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountHouseApp,
  type HouseAppHostOptions,
  type HouseAppSession,
} from '../../component-runtime/src/app-host';
import { APP_ABI, COMPONENT_ABI, POINTER_SCHEMA } from '../../component-runtime/src/contract';

const SANDBOX = 'https://sandbox.miakapp.test';
const NONCE = 'n'.repeat(32);

function release(abi: typeof APP_ABI | typeof COMPONENT_ABI = APP_ABI) {
  const bytes = new TextEncoder().encode('void 0');
  return {
    pointer: {
      schema: POINTER_SCHEMA,
      home_id: 'home-a',
      generation: 1,
      release: 'r1',
      abi,
      url: 'https://artifacts.miakapp.test/r1.js',
      sha256: 'A'.repeat(43),
      size: bytes.byteLength,
      requires: {
        state_read: ['zone.*'],
        event_subscribe: [],
        event_publish: [],
        call: ['lighting.set'],
        presentation: [],
      },
    },
    artifact: { bytes },
  };
}

interface Harness {
  readonly container: HTMLElement;
  readonly lifecycle: string[];
  readonly call: ReturnType<typeof vi.fn>;
  readonly options: HouseAppHostOptions;
}

function harness(overrides: Partial<HouseAppHostOptions> = {}): Harness {
  const container = document.createElement('div');
  document.body.append(container);
  const lifecycle: string[] = [];
  const call = vi.fn(async () => ({ applied: true }));
  return {
    container,
    lifecycle,
    call,
    options: {
      sandboxOrigin: SANDBOX,
      container,
      home: { id: 'home-a', name: 'Maison A' },
      title: 'Interface de Maison A',
      initialState: { values: { 'zone.light': true, 'alarm.code': '1234' }, revision: 1, stale: false },
      call,
      onLifecycle: (next, failure) => lifecycle.push(failure === undefined ? next : `${next}:${failure}`),
      randomId: () => NONCE,
      ...overrides,
    },
  };
}

/**
 * Plays the frame's half: announces readiness from the frame's window with the
 * given origin and returns the port the shell transferred, plus what arrives on it.
 */
async function bind(frame: HTMLIFrameElement, origin = 'null') {
  const frameWindow = frame.contentWindow!;
  let port: MessagePort | undefined;
  vi.spyOn(frameWindow, 'postMessage').mockImplementation(((_message: unknown, _target: unknown, transfer?: Transferable[]) => {
    port = transfer?.[0] as MessagePort;
  }) as typeof frameWindow.postMessage);
  window.dispatchEvent(new MessageEvent('message', {
    source: frameWindow,
    origin,
    data: { type: 'miakapp.app.ready', runtime: '1', nonce: NONCE },
  }));
  const received: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  port?.addEventListener('message', (event: MessageEvent) => received.push(event.data));
  port?.start();
  return { port, received };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

let session: HouseAppSession | undefined;

afterEach(() => {
  session?.dispose();
  session = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountHouseApp — the shell side of the frame boundary', () => {
  it('does not create a frame for a previously cancelled mount', async () => {
    const controller = new AbortController();
    controller.abort();
    const { container, options } = harness({ signal: controller.signal });
    await expect(mountHouseApp(release(), options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('cancels readiness immediately and ignores a late ready announcement', async () => {
    const controller = new AbortController();
    const { container, options, lifecycle } = harness({ signal: controller.signal });
    const mounting = mountHouseApp(release(), options);
    const frame = container.querySelector('iframe')!;
    const frameWindow = frame.contentWindow!;
    const post = vi.spyOn(frameWindow, 'postMessage');
    controller.abort();
    expect(container.querySelector('iframe')).toBeNull();
    await expect(mounting).rejects.toMatchObject({ name: 'AbortError' });
    window.dispatchEvent(new MessageEvent('message', { source: frameWindow, origin: 'null',
      data: { type: 'miakapp.app.ready', runtime: '1', nonce: NONCE } }));
    expect(post).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['starting', 'disposed']);
  });

  it('aborting an active session stops its in-flight call and further state delivery', async () => {
    const controller = new AbortController();
    let callSignal: AbortSignal | undefined;
    const call = vi.fn((_name, _args, opts) => {
      callSignal = opts.signal;
      return new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve(null)));
    });
    const { container, options } = harness({ signal: controller.signal, call });
    const mounting = mountHouseApp(release(), options);
    const { port, received } = await bind(container.querySelector('iframe')!);
    session = await mounting;
    port!.postMessage({ v: 1, kind: 'call.start', payload: { id: 'c1', name: 'lighting.set', args: null, timeout_ms: 1000 } });
    await flush();
    expect(call).toHaveBeenCalledOnce();
    controller.abort();
    expect(callSignal?.aborted).toBe(true);
    expect(session.lifecycle).toBe('disposed');
    expect(container.querySelector('iframe')).toBeNull();
    session.publishState({ values: { 'zone.light': false }, revision: 2, stale: false });
    await flush();
    expect(received.some(message => message.kind === 'state.snapshot' || message.kind === 'call.settled')).toBe(false);
  });

  it('creates one confined, visible frame inside the stage it was given', async () => {
    const { container, options } = harness();
    const mounting = mountHouseApp(release(), options);
    const frame = container.querySelector('iframe')!;

    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(frame.getAttribute('allow')).toContain("fullscreen 'none'");
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.src).toBe(`${SANDBOX}/app.html#nonce=${NONCE}`);
    expect(frame.title).toBe('Interface de Maison A');

    const { received } = await bind(frame);
    session = await mounting;
    await flush();
    const load = received.find((message) => message.kind === 'app.load')!;
    // Only granted state crosses; the release's grant, not the home's, applies.
    expect((load.payload.state as { values: unknown }).values).toEqual({ 'zone.light': true });
    expect(load.payload.grant).toEqual({ state_read: ['zone.*'], call: ['lighting.set'] });
    // Transferred bytes; checked by tag because the port crosses realms in jsdom.
    expect(Object.prototype.toString.call(load.payload.artifact)).toBe('[object ArrayBuffer]');
  });

  it('refuses a frame that is not confined to an opaque origin', async () => {
    const { container, lifecycle, options } = harness();
    const mounting = mountHouseApp(release(), options);
    await bind(container.querySelector('iframe')!, 'https://sandbox.miakapp.test');
    await expect(mounting).rejects.toMatchObject({ code: 'sandbox_origin_invalid' });
    expect(lifecycle).toContain('crashed:sandbox_origin_invalid');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('ignores announcements from any window but its own frame', async () => {
    const { container, lifecycle, options } = harness({ frameReadyMs: 50 });
    const mounting = mountHouseApp(release(), options);
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: 'null',
      data: { type: 'miakapp.app.ready', runtime: '1', nonce: NONCE },
    }));
    await expect(mounting).rejects.toMatchObject({ code: 'sandbox_unreachable' });
    expect(lifecycle).toContain('crashed:sandbox_unreachable');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('refuses to frame a semantic component or a same-origin sandbox', async () => {
    const first = harness();
    await expect(mountHouseApp(release(COMPONENT_ABI), first.options)).rejects.toMatchObject({ code: 'abi_mismatch' });
    const second = harness({ sandboxOrigin: window.location.origin });
    await expect(mountHouseApp(release(), second.options)).rejects.toMatchObject({ code: 'sandbox_origin_invalid' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('forwards granted calls, denies the rest, and never forwards state outside the grant', async () => {
    const { call, container, options } = harness();
    const mounting = mountHouseApp(release(), options);
    const { port, received } = await bind(container.querySelector('iframe')!);
    session = await mounting;

    port!.postMessage({ v: 1, kind: 'call.start', payload: { id: 'c1', name: 'lighting.set', args: { on: true }, timeout_ms: 1_000 } });
    port!.postMessage({ v: 1, kind: 'call.start', payload: { id: 'c2', name: 'door.unlock', args: null, timeout_ms: 1_000 } });
    await flush();
    await flush();

    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toBe('lighting.set');
    expect(received.filter((message) => message.kind === 'call.settled').map((message) => message.payload))
      .toEqual(expect.arrayContaining([
        { id: 'c1', ok: true, value: { applied: true } },
        { id: 'c2', ok: false, error: 'denied' },
      ]));

    session.publishState({ values: { 'zone.light': false, 'alarm.code': '9999' }, revision: 2, stale: false });
    session.publishState({ values: {}, revision: 3, stale: true });
    // A revision that moves backward is not forwarded.
    session.publishState({ values: { 'zone.light': true }, revision: 2, stale: false });
    await flush();
    expect(received.filter((message) => message.kind.startsWith('state.'))).toEqual([
      { v: 1, kind: 'state.snapshot', payload: { revision: 2, values: { 'zone.light': false } } },
      { v: 1, kind: 'state.stale', payload: { revision: 3 } },
    ]);
  });

  it('ends the session on anything outside the protocol', async () => {
    const { container, lifecycle, options } = harness();
    const mounting = mountHouseApp(release(), options);
    const { port } = await bind(container.querySelector('iframe')!);
    session = await mounting;
    port!.postMessage({ v: 1, kind: 'ui.render', payload: { html: '<img src=x onerror=alert(1)>' } });
    await flush();
    expect(lifecycle).toContain('crashed:protocol_violation');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('becomes active only when the home says it drew its first screen', async () => {
    const { container, lifecycle, options } = harness();
    const mounting = mountHouseApp(release(), options);
    const { port } = await bind(container.querySelector('iframe')!);
    session = await mounting;
    expect(lifecycle).toEqual(['starting', 'loading']);
    port!.postMessage({ v: 1, kind: 'app.ready', payload: {} });
    await flush();
    expect(lifecycle).toEqual(['starting', 'loading', 'active']);
  });

  it('gives up on a home that never draws', async () => {
    const { container, lifecycle, options } = harness({ bootMs: 20 });
    const mounting = mountHouseApp(release(), options);
    await bind(container.querySelector('iframe')!);
    session = await mounting;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(lifecycle).toContain('crashed:boot_timeout');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
