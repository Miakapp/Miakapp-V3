import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import { createDemoHost } from './demo-host';
import type { HomeState, TrustedHost, TrustedHostSnapshot } from './host';

function activatedRelease(release: string, fellBack: boolean): ActivatedRelease {
  return {
    pointer: { release } as ActivatedRelease['pointer'],
    artifact: {} as ActivatedRelease['artifact'],
    fellBack,
  };
}

describe('App', () => {
  it('makes preview boundaries explicit and updates local semantic state', async () => {
    const user = userEvent.setup();
    render(<App />);

    const previewStatus = screen.getByRole('status', { name: 'Interactive product preview' });
    expect(previewStatus).toHaveTextContent('Interactive product preview');
    expect(previewStatus).toHaveTextContent('No cloud, relay, or home is connected.');
    expect(screen.getByText('3 lights on')).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Kitchen' }));

    expect(screen.getByText('4 lights on')).toBeVisible();
  });

  it('navigates to the privacy explanation without a router or network call', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settingsButtons = screen.getAllByRole('button', { name: 'Settings' });
    await user.click(settingsButtons[0]!);

    expect(screen.getByRole('heading', { level: 1, name: 'Connection & privacy' })).toBeVisible();
    expect(screen.getByText('No cloud or home connection is active in this build.')).toBeVisible();
    expect(screen.getByText(/cannot inject HTML, CSS, URLs, or credentials/)).toBeVisible();
  });

  it('disposes the trusted host when the React shell unmounts', () => {
    const host = createDemoHost();
    const dispose = vi.spyOn(host, 'dispose');
    const view = render(<App createHost={() => host} />);

    view.unmount();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the static host footer when no component release is configured', () => {
    render(<App createComponentRelease={() => undefined} />);

    expect(screen.getByText('Semantic host · ABI 1')).toBeVisible();
  });

  it('activates the verified component release from the render path', async () => {
    const activate = vi.fn(
      async (signal?: AbortSignal): Promise<ActivatedRelease> => {
        void signal;
        return activatedRelease('2026.09.15-1', false);
      },
    );
    render(<App createComponentRelease={() => ({ activate })} />);

    expect(screen.getByText('Verifying component release')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByText('Component 2026.09.15-1 · verified')).toBeVisible();
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(activate.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it('says so when the shell rendered the last known good component', async () => {
    const coordinator: ComponentReleaseCoordinator = {
      activate: async () => activatedRelease('2026.09.14-3', true),
    };
    render(<App createComponentRelease={() => coordinator} />);

    await waitFor(() => {
      expect(screen.getByText('Component 2026.09.14-3 · last known good')).toBeVisible();
    });
  });

  it('degrades to a stated failure instead of a blank shell', async () => {
    const coordinator: ComponentReleaseCoordinator = {
      activate: async () => { throw new Error('pointer rejected'); },
    };
    render(<App createComponentRelease={() => coordinator} />);

    await waitFor(() => {
      expect(screen.getByText('Component release unavailable')).toBeVisible();
    });
    expect(screen.getByText('3 lights on')).toBeVisible();
  });

  it('abandons an in-flight activation when the shell unmounts', () => {
    let observed: AbortSignal | undefined;
    const view = render(
      <App
        createComponentRelease={() => ({
          activate: async (signal) => {
            observed = signal;
            return await new Promise<ActivatedRelease>(() => undefined);
          },
        })}
      />,
    );

    expect(observed?.aborted).toBe(false);
    view.unmount();
    expect(observed?.aborted).toBe(true);
  });
});

const SANDBOX_ORIGIN = 'https://sandbox.miakapp.test';

function runtimeTree(title: string): unknown {
  return {
    id: 'runtime-screen',
    type: 'screen',
    props: { title },
    children: [
      {
        id: 'runtime-action',
        type: 'button',
        props: { label: 'Run it', handler: 'runtime.action', variant: 'primary' },
      },
    ],
  };
}

function releaseWithArtifact(bytes: Uint8Array): ActivatedRelease {
  return {
    pointer: { release: '2026.09.15-runtime' } as ActivatedRelease['pointer'],
    artifact: { bytes } as unknown as ActivatedRelease['artifact'],
    fellBack: false,
  };
}

function coordinatorFor(release: ActivatedRelease): ComponentReleaseCoordinator {
  return { activate: async () => release };
}

describe('App component runtime call site', () => {
  it('never mounts the runtime when the deployment declares no sandbox origin', async () => {
    const mountRuntime = vi.fn();
    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Component 2026\.09\.15-runtime/)).toBeVisible();
    });
    expect(mountRuntime).not.toHaveBeenCalled();
    // The shell keeps rendering the trusted host's own tree.
    expect(screen.getByText('3 lights on')).toBeVisible();
  });

  it('never mounts the runtime when no release was verified', () => {
    const mountRuntime = vi.fn();
    render(
      <App
        createComponentRelease={() => undefined}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    expect(mountRuntime).not.toHaveBeenCalled();
    expect(screen.getByText('Semantic host · ABI 1')).toBeVisible();
  });

  it('runs the verified artifact in the declared sandbox and renders what it returns', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as { onTree: (tree: unknown, revision: number) => void };
      opts.onTree(runtimeTree('Runtime speaking'), 4);
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(bytes))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeVisible();
    });

    const [passedRelease, passedOptions] = mountRuntime.mock.calls[0]! as unknown as [
      { pointer: { release: string }; artifact: { bytes: Uint8Array } },
      { sandboxOrigin: string; container: HTMLElement },
    ];
    expect(passedRelease.artifact.bytes).toBe(bytes);
    expect(passedRelease.pointer.release).toBe('2026.09.15-runtime');
    expect(passedOptions.sandboxOrigin).toBe(SANDBOX_ORIGIN);
    expect(passedOptions.container).toBe(screen.getByTestId('component-runtime-surface'));
    expect(screen.getByText('Component runtime · revision 4')).toBeVisible();
    // The runtime's tree replaces the host's, it does not render beside it.
    expect(screen.queryByText('3 lights on')).toBeNull();
  });

  it('routes interactions on the runtime tree to the runtime, never to the trusted host', async () => {
    const user = userEvent.setup();
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const host = createDemoHost();
    const hostInteract = vi.spyOn(host, 'interact');
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      (options as unknown as { onTree: (t: unknown, r: number) => void })
        .onTree(runtimeTree('Runtime speaking'), 1);
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        createHost={() => host}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run it' })).toBeVisible();
    });
    await user.click(screen.getByRole('button', { name: 'Run it' }));

    expect(session.interact).toHaveBeenCalledWith('runtime.action', 'press', undefined);
    expect(hostInteract).not.toHaveBeenCalled();
  });

  it('falls back to the trusted host tree when the runtime dies', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onTree: (t: unknown, r: number) => void;
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      opts.onTree(runtimeTree('Runtime speaking'), 1);
      opts.onLifecycle('failed', {
        code: 'bridge_protocol_violation',
        message: 'bad envelope',
      });
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Component runtime stopped · bridge_protocol_violation'))
        .toBeVisible();
    });
    expect(screen.queryByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeNull();
    expect(screen.getByText('3 lights on')).toBeVisible();
  });

  it('keeps a component-authored failure code out of the shell chrome', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      // `runtime.error` copies this straight off the bridge, so the component
      // is choosing the text. Rendering it would rent it a line of trusted UI.
      opts.onLifecycle('failed', {
        code: 'Session expired — sign in again at evil.example',
        message: 'phishing',
      });
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Component runtime stopped · unclassified')).toBeVisible();
    });
    expect(screen.queryByText(/evil\.example/)).toBeNull();
  });

  it('reports the failure that made the shell fall back', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      opts.onLifecycle('failed', { code: 'ready_timeout', message: 'no readiness' });
      return { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readDiagnosticsEndpoint={() => 'https://diagnostics.example/runtime'}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Component runtime stopped · ready_timeout')).toBeVisible();
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    const [endpoint, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(endpoint).toBe('https://diagnostics.example/runtime');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual({
      schema: 'miakapp.runtime-diagnostics/1',
      code: 'ready_timeout',
      release: '2026.09.15-runtime',
      at: expect.any(String),
    });
    fetchSpy.mockRestore();
  });

  it('stays silent when no diagnostics endpoint is declared', async () => {
    const mountRuntime = vi.fn(async () => {
      throw new Error('sandbox unreachable');
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Component runtime stopped · mount_failed')).toBeVisible();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('disposes the runtime session when the shell unmounts', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async () => session);

    const view = render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(mountRuntime).toHaveBeenCalledOnce();
    });
    view.unmount();

    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a mount that only lands after the shell unmounted', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    let settle: (() => void) | undefined;
    const mountRuntime = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      return session;
    });

    const view = render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(settle).toBeDefined();
    });
    view.unmount();
    settle!();

    // An orphan frame and its port would otherwise stay alive with no owner.
    await waitFor(() => {
      expect(session.dispose).toHaveBeenCalledOnce();
    });
  });
});

const SUBSTITUTED_SCREEN = /This is the home’s own screen/;

describe('App home screen provenance', () => {
  it('says whose screen this is while the component screen starts', async () => {
    const session = { lifecycle: 'starting' as const, interact: vi.fn(), dispose: vi.fn() };
    // A mount that resolves without ever producing a tree: the runtime is up,
    // the component has not rendered yet.
    const mountRuntime = vi.fn(async () => session);

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(
        'This is the home’s own screen. The component screen is still starting.',
      )).toBeVisible();
    });
    expect(screen.getByText('3 lights on')).toBeVisible();
  });

  it('names the substitution where it happened, not only in the footer', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onTree: (t: unknown, r: number) => void;
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      opts.onTree(runtimeTree('Runtime speaking'), 1);
      opts.onLifecycle('failed', { code: 'bridge_protocol_violation', message: 'bad envelope' });
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    const notice = await screen.findByText(
      'This is the home’s own screen. The component screen stopped.',
    );
    // The substituted screen is the one it sits above: both screens are real and
    // both answer, so proximity is what tells a person which controls these are.
    const home = document.querySelector('.home-screen');
    expect(home).not.toBeNull();
    expect(home!.contains(notice)).toBe(true);
    expect(home!.textContent).toContain('3 lights on');
    expect(screen.getAllByText('bridge_protocol_violation').length).toBeGreaterThan(0);
  });

  it('keeps a component-authored failure code out of the notice', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      opts.onLifecycle('failed', {
        code: 'Reconnect your home at evil.example',
        message: 'phishing',
      });
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(SUBSTITUTED_SCREEN)).toBeVisible();
    });
    // The notice is the most legible line the shell owns; renting it to the
    // component is how a sandboxed bundle would phish from trusted chrome.
    expect(document.querySelector('.home-screen')!.textContent)
      .not.toContain('evil.example');
  });

  it('stays silent when the component screen is the one on display', async () => {
    const session = { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as { onTree: (t: unknown, r: number) => void };
      opts.onTree(runtimeTree('Runtime speaking'), 1);
      return session;
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeVisible();
    });
    expect(screen.queryByText(SUBSTITUTED_SCREEN)).toBeNull();
  });

  it('stays silent when the build expected no component screen', () => {
    render(<App createComponentRelease={() => undefined} />);

    // Nothing was substituted, so there is nothing to explain: the preview and
    // every build without a sandbox origin read exactly as they did before.
    expect(screen.queryByText(SUBSTITUTED_SCREEN)).toBeNull();
    expect(screen.getByText('3 lights on')).toBeVisible();
  });
});

describe('App home state delivery', () => {
  function hostWith(homeState: HomeState | undefined): () => TrustedHost {
    const base = createDemoHost();
    const snapshot: TrustedHostSnapshot = {
      ...base.getSnapshot(),
      ...(homeState === undefined ? {} : { homeState }),
    };
    return () => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      interact: vi.fn(),
      dispose: vi.fn(),
    });
  }

  function runtimeSpy() {
    const session = {
      lifecycle: 'active' as const,
      interact: vi.fn(),
      dispose: vi.fn(),
      publishState: vi.fn(),
      markStateStale: vi.fn(),
    };
    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as { onTree: (t: unknown, r: number) => void };
      opts.onTree(runtimeTree('Runtime speaking'), 1);
      return session;
    });
    return { session, mountRuntime };
  }

  it('hands the running component the home state the shell holds', async () => {
    const { session, mountRuntime } = runtimeSpy();

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        createHost={hostWith({
          values: { 'zone.alpha.light.on': true },
          revision: 12,
          stale: false,
        })}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    // Filtering to the grant is the runtime host's job; the shell's is to hand
    // over what it has, once the session exists to receive it.
    await waitFor(() => {
      expect(session.publishState)
        .toHaveBeenCalledWith({ 'zone.alpha.light.on': true }, 12);
    });
    expect(session.markStateStale).not.toHaveBeenCalled();
  });

  it('says the state is old rather than handing over an empty home', async () => {
    const { session, mountRuntime } = runtimeSpy();

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        // The live host blanks its own values on staleness. Publishing those
        // blanks would tell the component the home is freshly empty.
        createHost={hostWith({ values: {}, revision: 12, stale: true })}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(session.markStateStale).toHaveBeenCalledWith(12, 'home_state_stale');
    });
    expect(session.publishState).not.toHaveBeenCalled();
  });

  it('publishes nothing when the build has no live home', async () => {
    const { session, mountRuntime } = runtimeSpy();

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        createHost={hostWith(undefined)}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeVisible();
    });
    expect(session.publishState).not.toHaveBeenCalled();
    expect(session.markStateStale).not.toHaveBeenCalled();
  });
});
