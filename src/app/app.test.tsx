import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import { createDemoHost } from './demo-host';

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
      opts.onLifecycle('failed', { code: 'contract_violation', message: 'bad envelope' });
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
      expect(screen.getByText('Component runtime stopped · contract_violation')).toBeVisible();
    });
    expect(screen.queryByRole('heading', { level: 1, name: 'Runtime speaking' })).toBeNull();
    expect(screen.getByText('3 lights on')).toBeVisible();
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
