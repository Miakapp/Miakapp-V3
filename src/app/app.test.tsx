import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { COMPONENT_ABI, type CapabilityRequirements } from '../../component-runtime/src/contract';
import { App as ShellApp, type AppProps } from './app';
import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import { createPreviewHost } from './preview-host';
import { createHouseConsentStore, type HouseConsentStore } from './house-consent';

/**
 * These cases exercise release activation after the resident agreed
 * to open the home's interface; the agreement itself is covered by
 * `house-shell.test.tsx`.
 */
function agreedConsent(): HouseConsentStore {
  const store = createHouseConsentStore(undefined);
  store.grant('home_preview');
  return store;
}

const NO_REQUIREMENTS: CapabilityRequirements = {
  state_read: ['zone.*'],
  event_subscribe: [],
  event_publish: [],
  call: [],
  presentation: [],
};

function App(props: AppProps): React.JSX.Element {
  return <ShellApp consentStore={agreedConsent()} {...props} />;
}

function activatedRelease(release: string, fellBack: boolean): ActivatedRelease {
  return {
    pointer: { release, abi: COMPONENT_ABI, requires: NO_REQUIREMENTS } as ActivatedRelease['pointer'],
    artifact: {} as ActivatedRelease['artifact'],
    fellBack,
  };
}

describe('App', () => {
  it('says a preview build has no home interface to open', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Preview home has no interface yet' })).toBeVisible();
  });

  it('disposes the trusted host when the React shell unmounts', () => {
    const host = createPreviewHost();
    const dispose = vi.spyOn(host, 'dispose');
    const view = render(<App createHost={() => host} />);

    view.unmount();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('activates the verified component release from the render path', async () => {
    const activate = vi.fn(
      async (signal?: AbortSignal): Promise<ActivatedRelease> => {
        void signal;
        return activatedRelease('2026.09.15-1', false);
      },
    );
    render(<App createComponentRelease={() => ({ activate })} />);

    // While the home's interface is fetched and verified, the house shell says
    // which home is opening rather than showing the platform's own screen.
    expect(screen.getByRole('status')).toHaveTextContent('Opening Preview home…');
    await waitFor(() => expect(activate).toHaveBeenCalledOnce());
    expect(activate.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it('shows a semantic component release as no interface rather than drawing it', async () => {
    const coordinator: ComponentReleaseCoordinator = {
      activate: async () => activatedRelease('2026.09.14-3', true),
    };
    render(<App createComponentRelease={() => coordinator} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Preview home has no interface yet' })).toBeVisible();
    expect(document.body.textContent ?? '').not.toContain('2026.09.14-3');
  });

  it('degrades to a stated failure with a retry instead of a blank shell', async () => {
    const user = userEvent.setup();
    const activate = vi.fn(async (): Promise<ActivatedRelease> => {
      throw new Error('pointer rejected');
    });
    render(<App createComponentRelease={() => ({ activate })} />);

    expect(await screen.findByRole('heading', { name: 'Preview home’s interface is unavailable' })).toBeVisible();
    // The Miakapp controls stay usable around the failure.
    expect(screen.getByRole('button', { name: /Miakapp menu/u })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
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
