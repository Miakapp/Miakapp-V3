import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDemoHost } from './demo-host';
import type { TrustedHost, TrustedHostSnapshot } from './host';
import { agentStartPrompt, COPY } from './copy';
import { ProductApp } from './product-app';

const FR_PROMPT = agentStartPrompt('fr');
const EN_PROMPT = agentStartPrompt('en');

const fr = COPY.fr;
const en = COPY.en;

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
    render(<ProductApp initialLocale="fr" />);

    expect(screen.getByRole('heading', {
      level: 1,
      name: fr.landingTitle,
    })).toBeVisible();
    expect(screen.getAllByRole('button', { name: fr.navCreate })).toHaveLength(2);
    expect(screen.queryByText('3 lights on')).toBeNull();
  });

  it('hands a visitor the prompt without asking for an account first', async () => {
    const user = userEvent.setup();
    // A signed-out visitor on a live build: the case the sign-in gate used to
    // intercept. The two things that make Miakapp concrete — the prompt and the
    // Molted path — are the whole reason someone came, so they come first.
    const { host, signIn } = mutableLiveHost();
    render(<ProductApp createHost={() => host} initialLocale="fr" />);

    await user.click(screen.getAllByRole('button', { name: fr.navCreate })[1]!);

    expect(screen.getByRole('heading', {
      level: 1,
      name: fr.onboardingTitle,
    })).toBeVisible();
    expect(screen.getByText(FR_PROMPT)).toBeVisible();
    expect(screen.getByRole('link', { name: /Utiliser dans molted\.cloud/u })).toBeVisible();
    expect(window.location.pathname).toBe('/new-home');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says where the account actually comes from, so its absence reads as a choice', () => {
    render(<ProductApp createHost={() => mutableLiveHost().host} initialLocale="fr" initialRoute="new-home" />);

    // The agent sends a link when it needs to issue the Home Key; that is the
    // moment the account is created. A page with no sign-up and no explanation
    // reads as an unfinished page.
    expect(screen.getByText(fr.onboardingAccountTitle)).toBeVisible();
    expect(screen.getByText(/il vous enverra un lien/u)).toBeVisible();
  });

  it('opens a deep link to the prompt for a signed-out visitor', () => {
    window.history.replaceState({}, '', '/new-home');
    // The link the agent sends lands here. Bouncing it to a login page would
    // break the one flow this page exists to serve.
    render(<ProductApp createHost={() => mutableLiveHost().host} initialLocale="fr" />);

    expect(screen.getByRole('heading', {
      level: 1,
      name: fr.onboardingTitle,
    })).toBeVisible();
  });

  it('opens the existing-home console after the regular sign-in entry point', async () => {
    const user = userEvent.setup();
    const { host } = mutableLiveHost();
    render(<ProductApp createHost={() => host} initialLocale="fr" />);

    await user.click(screen.getByRole('button', { name: fr.navSignIn }));
    await user.click(screen.getByRole('button', { name: fr.loginGoogle }));

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
        initialLocale="fr"
        initialRoute="new-home"
        writeClipboard={writeClipboard}
      />,
    );

    expect(screen.getByText(FR_PROMPT)).toBeVisible();
    await user.click(screen.getByRole('button', { name: fr.onboardingCopy }));

    expect(writeClipboard).toHaveBeenCalledWith(FR_PROMPT);
    await waitFor(() => expect(screen.getByRole('button', { name: fr.onboardingCopied })).toBeVisible());
  });

  it('keeps the prompt usable when clipboard access is refused', async () => {
    const user = userEvent.setup();
    const { host } = mutableLiveHost(true);
    const writeClipboard = vi.fn(async () => Promise.reject(new Error('denied')));
    render(
      <ProductApp
        createHost={() => host}
        initialLocale="fr"
        initialRoute="new-home"
        writeClipboard={writeClipboard}
      />,
    );

    await user.click(screen.getByRole('button', { name: fr.onboardingCopy }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Copie impossible. Sélectionnez le prompt ci-dessus.',
    );
    expect(screen.getByText(FR_PROMPT)).toBeVisible();
  });

  it('offers Molted as the recommended managed path', () => {
    const { host } = mutableLiveHost(true);
    render(<ProductApp createHost={() => host} initialLocale="fr" initialRoute="new-home" />);

    const molted = screen.getByRole('link', { name: new RegExp(fr.onboardingMoltedCta, 'u') });
    expect(molted).toHaveAttribute('href', 'https://molted.cloud');
    expect(screen.getByText('Recommandé')).toBeVisible();
  });

  it('keeps the existing interactive console available as the demo', async () => {
    const user = userEvent.setup();
    render(<ProductApp initialLocale="fr" />);

    await user.click(screen.getByRole('button', { name: fr.landingSecondaryCta }));

    expect(screen.getByText('3 lights on')).toBeVisible();
    expect(window.location.pathname).toBe('/app');
  });
});

describe('Miakapp language', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('answers a visitor in the language their browser asked for', () => {
    render(<ProductApp initialLocale="en" />);

    expect(screen.getByRole('heading', { level: 1, name: en.landingTitle })).toBeVisible();
    expect(screen.queryByText(fr.landingTitle)).toBeNull();
  });

  it('switches the whole page, not a fragment of it', async () => {
    const user = userEvent.setup();
    render(<ProductApp initialLocale="fr" />);

    expect(screen.getByRole('heading', { level: 1, name: fr.landingTitle })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /English/u }));

    // The headline, the calls to action and the bands below all follow, because
    // a half-translated page is worse than an untranslated one.
    expect(screen.getByRole('heading', { level: 1, name: en.landingTitle })).toBeVisible();
    expect(screen.getByRole('button', { name: en.landingSecondaryCta })).toBeVisible();
    expect(screen.getByText(en.audienceNewcomerBody)).toBeVisible();
    expect(screen.queryByText(fr.landingLede)).toBeNull();
  });

  it('tells the document which language it is in', async () => {
    const user = userEvent.setup();
    render(<ProductApp initialLocale="en" />);

    expect(document.documentElement.lang).toBe('en');

    // This is what a screen reader picks a voice from; leaving it stale makes an
    // English page read aloud in French.
    await user.click(screen.getByRole('button', { name: /Français/u }));
    expect(document.documentElement.lang).toBe('fr');
  });

  it('names each language in its own language, not in the current one', () => {
    render(<ProductApp initialLocale="fr" />);

    // Someone who cannot read the page they landed on still has to find the way
    // out, so the switch never translates its own options.
    expect(screen.getByRole('button', { name: /English/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Français/u })).toBeVisible();
  });

  it('shows and copies the prompt in the page language, with the commands left verbatim', async () => {
    const user = userEvent.setup();
    const writeClipboard = vi.fn(async () => undefined);
    render(<ProductApp initialLocale="fr" initialRoute="new-home" writeClipboard={writeClipboard} />);

    expect(screen.getByText(FR_PROMPT)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /English/u }));
    expect(screen.getByText(EN_PROMPT)).toBeVisible();
    expect(screen.queryByText(FR_PROMPT)).toBeNull();
    expect(EN_PROMPT).not.toMatch(/Installe|puis|pour commencer/u);

    await user.click(screen.getByRole('button', { name: en.onboardingCopy }));
    expect(writeClipboard).toHaveBeenCalledWith(EN_PROMPT);

    // An agent runs the commands, so both languages carry the very same ones.
    for (const prompt of [FR_PROMPT, EN_PROMPT]) {
      expect(prompt).toContain('`npm i -g @miakapp/cli`');
      expect(prompt).toContain('`miakapp docs start`');
    }
  });
});
