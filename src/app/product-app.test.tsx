import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDemoHost } from './demo-host';
import type { TrustedHost, TrustedHostSnapshot } from './host';
import { AGENT_START_PROMPT, ProductApp } from './product-app';

interface MutableHost {
  readonly host: TrustedHost;
  readonly signIn: ReturnType<typeof vi.fn>;
}

function mutableLiveHost(authenticated = false): MutableHost {
  const demo = createDemoHost();
  const listeners = new Set<() => void>();
  let signedIn = authenticated;
  let snapshot: TrustedHostSnapshot;

  const rebuild = (): void => {
    snapshot = {
      ...demo.getSnapshot(),
      authenticated: signedIn,
      preview: false,
      signInAvailable: !signedIn,
      modeLabel: 'Staging',
      noticeTitle: signedIn ? 'Live staging connection' : 'Connect to Miakapp staging',
    };
  };
  rebuild();

  const signIn = vi.fn(() => {
    signedIn = true;
    rebuild();
    for (const listener of listeners) listener();
  });

  return {
    signIn,
    host: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      interact: demo.interact,
      signIn,
      dispose: demo.dispose,
    },
  };
}

describe('Miakapp product entry flow', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('opens on a public landing page instead of dropping into a home console', () => {
    render(<ProductApp />);

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'L’interface de votre maison ne devrait ressembler qu’à vous.',
    })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Créer ma maison' })).toHaveLength(2);
    expect(screen.queryByText('3 lights on')).toBeNull();
  });

  it('puts Google sign-in between a visitor and the new-home flow', async () => {
    const user = userEvent.setup();
    const { host, signIn } = mutableLiveHost();
    render(<ProductApp createHost={() => host} />);

    await user.click(screen.getAllByRole('button', { name: 'Créer ma maison' })[1]!);
    expect(screen.getByRole('heading', { level: 1, name: 'Retrouvez votre maison.' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continuer avec Google' }));
    expect(signIn).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByRole('heading', {
        level: 1,
        name: 'Donnez ce point de départ à votre agent.',
      })).toBeVisible();
    });
    expect(window.location.pathname).toBe('/new-home');
  });

  it('opens the existing-home console after the regular sign-in entry point', async () => {
    const user = userEvent.setup();
    const { host } = mutableLiveHost();
    render(<ProductApp createHost={() => host} />);

    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    await user.click(screen.getByRole('button', { name: 'Continuer avec Google' }));

    await waitFor(() => expect(screen.getByText('3 lights on')).toBeVisible());
    expect(window.location.pathname).toBe('/app');
  });

  it('copies the exact command that a coding agent can execute', async () => {
    const user = userEvent.setup();
    const { host } = mutableLiveHost(true);
    const writeClipboard = vi.fn(async () => undefined);
    render(
      <ProductApp
        createHost={() => host}
        initialRoute="new-home"
        writeClipboard={writeClipboard}
      />,
    );

    expect(screen.getByText(AGENT_START_PROMPT)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Copier le prompt' }));

    expect(writeClipboard).toHaveBeenCalledWith(AGENT_START_PROMPT);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prompt copié' })).toBeVisible());
  });

  it('keeps the prompt usable when clipboard access is refused', async () => {
    const user = userEvent.setup();
    const { host } = mutableLiveHost(true);
    const writeClipboard = vi.fn(async () => Promise.reject(new Error('denied')));
    render(
      <ProductApp
        createHost={() => host}
        initialRoute="new-home"
        writeClipboard={writeClipboard}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copier le prompt' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Copie impossible. Sélectionnez le prompt ci-dessus.',
    );
    expect(screen.getByText(AGENT_START_PROMPT)).toBeVisible();
  });

  it('offers Molted as the recommended managed path', () => {
    const { host } = mutableLiveHost(true);
    render(<ProductApp createHost={() => host} initialRoute="new-home" />);

    const molted = screen.getByRole('link', { name: /Utiliser dans molted.cloud/ });
    expect(molted).toHaveAttribute('href', 'https://molted.cloud');
    expect(screen.getByText('Recommandé')).toBeVisible();
  });

  it('keeps the existing interactive console available as the demo', async () => {
    const user = userEvent.setup();
    render(<ProductApp />);

    await user.click(screen.getByRole('button', { name: 'Voir la maison de démonstration' }));

    expect(screen.getByText('3 lights on')).toBeVisible();
    expect(window.location.pathname).toBe('/app');
  });
});
