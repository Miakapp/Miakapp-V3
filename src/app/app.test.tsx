import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import { createDemoHost } from './demo-host';
import { HOST_FAILURE_CODES, type ClassifiedFailure } from './runtime-diagnostics';

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
      expect(screen.getByText('Component runtime stopped: it broke the host bridge.'
        + ' Showing the home\u2019s own controls instead.'))
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
      expect(screen.getByText('Component runtime stopped: the reason was not one the host recognises.'
        + ' Showing the home\u2019s own controls instead.')).toBeVisible();
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
      expect(screen.getByText('Component runtime stopped: it never finished starting.'
        + ' Showing the home\u2019s own controls instead.')).toBeVisible();
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
      expect(screen.getByText('Component runtime stopped: it could not be started.'
        + ' Showing the home\u2019s own controls instead.')).toBeVisible();
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
  // Second table over the same closed vocabulary. Adding a code to
  // `HOST_FAILURE_CODES` without naming it fails to compile here as well as in
  // the renderer, so the test cannot silently stop covering a reachable state.
  const EXPECTED_FAILURE_PROSE: Record<ClassifiedFailure, string> = {
    bridge_protocol_violation: 'it broke the host bridge',
    capability_denied: 'it asked for something it may not use',
    failed: 'it reported its own failure',
    mount_failed: 'it could not be started',
    ready_timeout: 'it never finished starting',
    render_invalid: 'it sent a screen the host refused',
    runtime_unresponsive: 'it went unresponsive',
    sandbox_origin_invalid: 'this deployment has no valid sandbox origin',
    terminated: 'the host shut it down',
    unclassified: 'the reason was not one the host recognises',
  };

  it.each([...HOST_FAILURE_CODES, 'unclassified' as const])(
    'names the %s failure in words and never as its identifier',
    async (code) => {
      const mountRuntime = vi.fn(async (_release: never, options: never) => {
        const opts = options as unknown as {
          onLifecycle: (l: string, f?: { code: string; message: string }) => void;
        };
        // `unclassified` is not a code the bridge can send; it is what the
        // classifier substitutes, so it has to be provoked by an unknown one.
        opts.onLifecycle('failed', {
          code: code === 'unclassified' ? 'component_invented_this' : code,
          message: 'stopped',
        });
        return { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
      });

      const view = render(
        <App
          createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
          mountRuntime={mountRuntime as never}
          readSandboxOrigin={() => SANDBOX_ORIGIN}
        />,
      );

      const region = screen.getByTestId('component-runtime-status');
      await waitFor(() => {
        expect(region).toHaveTextContent(EXPECTED_FAILURE_PROSE[code]);
      });
      // The reason is only half of it: the tree on screen is the home's own,
      // not the component's, and nothing else on the page says so.
      expect(region).toHaveTextContent('Showing the home\u2019s own controls instead.');
      expect(region.textContent).not.toContain(code === 'unclassified' ? 'unclassified' : code);
      view.unmount();
    },
  );

  it('keeps the runtime status region mounted before anything has failed', async () => {
    const view = render(<App createComponentRelease={() => undefined} />);

    // A live region that appears in the same commit as its first text is one
    // assistive technologies are allowed to miss, so the region has to exist
    // while it still has nothing to say.
    const region = screen.getByTestId('component-runtime-status');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
    view.unmount();

    const mountRuntime = vi.fn(async (_release: never, options: never) => {
      const opts = options as unknown as {
        onTree: (t: unknown, r: number) => void;
        onLifecycle: (l: string, f?: { code: string; message: string }) => void;
      };
      opts.onTree(runtimeTree('Runtime speaking'), 1);
      opts.onLifecycle('terminated');
      return { lifecycle: 'active' as const, interact: vi.fn(), dispose: vi.fn() };
    });

    render(
      <App
        createComponentRelease={() => coordinatorFor(releaseWithArtifact(new Uint8Array([1])))}
        mountRuntime={mountRuntime as never}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    // The same region that was empty now carries the reason, which is what
    // makes the mid-session swap audible rather than merely visible.
    await waitFor(() => {
      expect(screen.getByTestId('component-runtime-status'))
        .toHaveTextContent('the host shut it down');
    });
    expect(screen.queryByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeNull();
  });
});
