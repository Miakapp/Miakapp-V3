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
