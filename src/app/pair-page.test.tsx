import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COPY, type Locale } from './copy';
import { PairPage } from './pair-page';
import {
  PairingError,
  type IssuedPairingCode,
  type NewPairingHome,
  type PairingAccount,
  type PairingHome,
  type PairingHomeKey,
  type PairingService,
} from './pairing-client';
import { ProductApp } from './product-app';

const fr = COPY.fr;
const en = COPY.en;
const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const CODE = 'MIAK-01234-56789-ABCDE-FGHJK-MNPQR';

class FakePairing implements PairingService {
  readonly defaultRelayUrl: string | undefined;
  issuer: string | undefined = 'https://control-plane.example.test';
  account: PairingAccount | null | undefined = null;
  homes: PairingHome[] = [{ id: 'maison-lea', name: 'Maison de Léa', icon: 'house' }];
  keys: PairingHomeKey[] = [{ id: 'key-a', label: 'Molted agent', createdAtMs: NOW - 86_400_000, lastUsedAtMs: null }];
  issueFailures: PairingError[] = [];
  readonly issued: string[] = [];
  readonly created: NewPairingHome[] = [];
  readonly revoked: string[] = [];
  readonly signIn = vi.fn(async () => {
    this.account = { email: 'lea@example.test', name: 'Léa' };
    this.#emit();
  });
  readonly signOut = vi.fn(async () => {
    this.account = null;
    this.#emit();
  });
  readonly #listeners = new Set<() => void>();

  constructor(defaultRelayUrl: string | null = 'wss://relay.example.test/ws') {
    this.defaultRelayUrl = defaultRelayUrl ?? undefined;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  readonly getAccount = (): PairingAccount | null | undefined => this.account;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly listHomes = async (): Promise<readonly PairingHome[]> => [...this.homes];
  readonly createHome = async (input: NewPairingHome): Promise<PairingHome> => {
    this.created.push(input);
    const home = { id: input.id, name: input.name, icon: 'house' };
    this.homes.push(home);
    return home;
  };
  readonly issueCode = async (homeId: string): Promise<IssuedPairingCode> => {
    const failure = this.issueFailures.shift();
    if (failure !== undefined) throw failure;
    this.issued.push(homeId);
    return { code: CODE, homeId, scopes: [], expiresAtMs: NOW + 600_000 };
  };
  readonly listKeys = async (): Promise<readonly PairingHomeKey[]> => [...this.keys];
  readonly revokeKey = async (_homeId: string, keyId: string): Promise<void> => {
    this.revoked.push(keyId);
    this.keys = this.keys.filter((key) => key.id !== keyId);
  };
  readonly dispose = vi.fn();
}

function renderPage(service: PairingService | undefined, locale: Locale = 'fr', now: () => number = () => NOW) {
  const writeClipboard = vi.fn(async () => undefined);
  const t = (key: keyof typeof fr) => COPY[locale][key];
  render(<PairPage locale={locale} now={now} service={service} t={t} writeClipboard={writeClipboard} />);
  return { writeClipboard };
}

describe('agent pairing page', () => {
  beforeEach(() => window.history.replaceState({}, '', '/pair'));

  it('walks account → home → explicit consent → one code', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    const { writeClipboard } = renderPage(service);

    await user.click(screen.getByRole('button', { name: new RegExp(fr.pairAccountCta, 'u') }));
    expect(service.signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('lea@example.test')).toBeVisible();

    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    expect(screen.getByRole('heading', { name: 'Accès complet à « Maison de Léa »' })).toBeVisible();
    for (const grant of [fr.pairGrantCoordinator, fr.pairGrantCli, fr.pairGrantPush, fr.pairGrantComponents]) {
      expect(screen.getByText(grant)).toBeVisible();
    }

    // Nothing is issued until the person states the grant in so many words.
    const generate = screen.getByRole('button', { name: fr.pairConfirmSubmit });
    expect(generate).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Je donne à mon agent un accès complet à « Maison de Léa ».' }));
    await user.click(generate);

    expect(await screen.findByText(CODE)).toBeVisible();
    expect(service.issued).toEqual(['maison-lea']);
    expect(screen.getByRole('timer')).toHaveTextContent('Expire dans 10:00');
    // The exact command names this deployment's issuer and never the code.
    const command = 'miakapp pair --issuer https://control-plane.example.test';
    expect(screen.getByText(command)).toBeVisible();
    expect(screen.getByText(command).textContent).not.toContain(CODE);

    await user.click(screen.getByRole('button', { name: fr.pairCopyMessage }));
    const message = String((writeClipboard.mock.calls as unknown as string[][])[0]![0]);
    expect(message).toContain(`\`${command}\``);
    expect(message).toContain('entrée standard');
    expect(message).toContain(CODE);
    expect(message).not.toContain('--code');
    expect(screen.getByRole('button', { name: fr.pairCodeCopied })).toBeVisible();

    await user.click(screen.getByRole('button', { name: fr.pairCopyCode }));
    expect(writeClipboard).toHaveBeenLastCalledWith(CODE);
  });

  it('copies the agent message in the language the page is shown in', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    const { writeClipboard } = renderPage(service, 'en');
    await user.click(screen.getByRole('button', { name: new RegExp(COPY.en.pairAccountCta, 'u') }));
    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: COPY.en.pairConfirmSubmit }));
    await screen.findByText(CODE);
    await user.click(screen.getByRole('button', { name: COPY.en.pairCopyMessage }));
    const message = String((writeClipboard.mock.calls as unknown as string[][])[0]![0]);
    expect(message).toContain('standard input');
    expect(message).toContain('Pair with my Miakapp home “Maison de Léa”');
  });

  it('offers only the code when the deployment names no issuer', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.issuer = undefined;
    const { writeClipboard } = renderPage(service);
    await user.click(screen.getByRole('button', { name: new RegExp(fr.pairAccountCta, 'u') }));
    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: fr.pairConfirmSubmit }));
    await screen.findByText(CODE);
    expect(screen.queryByText(/miakapp pair/u)).toBeNull();
    await user.click(screen.getByRole('button', { name: fr.pairCodeCopy }));
    expect(writeClipboard).toHaveBeenCalledWith(CODE);
  });

  it('creates a home when the account administers none, then asks for consent', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.homes = [];
    service.account = { email: 'lea@example.test', name: null };
    renderPage(service, 'en');

    expect(await screen.findByText(en.pairHomesEmpty)).toBeVisible();
    await user.type(screen.getByLabelText(en.pairCreateName), 'Maison de Léa');
    expect(screen.getByLabelText(en.pairCreateId)).toHaveValue('maison-de-lea');
    await user.click(screen.getByRole('button', { name: en.pairCreateSubmit }));

    expect(service.created).toEqual([{ id: 'maison-de-lea', name: 'Maison de Léa', relayUrl: 'wss://relay.example.test/ws' }]);
    expect(await screen.findByRole('heading', { name: 'Full access to “Maison de Léa”' })).toBeVisible();
    expect(service.issued).toEqual([]);
  });

  it('requires a relay before creating a home when the deployment names none', async () => {
    const user = userEvent.setup();
    const service = new FakePairing(null);
    service.homes = [];
    service.account = { email: 'lea@example.test', name: null };
    renderPage(service, 'en');

    await user.type(await screen.findByLabelText(en.pairCreateName), 'Chalet');
    expect(screen.getByRole('button', { name: en.pairCreateSubmit })).toBeDisabled();
    await user.type(screen.getByLabelText(en.pairCreateRelay), 'wss://relay.self.test/ws');
    await user.click(screen.getByRole('button', { name: en.pairCreateSubmit }));
    expect(service.created[0]?.relayUrl).toBe('wss://relay.self.test/ws');
  });

  it('re-confirms identity when the sign-in is too old, then finishes what was asked', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.account = { email: 'lea@example.test', name: null };
    service.issueFailures = [new PairingError('stale_sign_in')];
    renderPage(service, 'en');

    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: en.pairConfirmSubmit }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.pairErrorStale);
    await user.click(within(alert).getByRole('button', { name: en.pairErrorStaleCta }));
    expect(service.signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(CODE)).toBeVisible();
    expect(service.issued).toEqual(['maison-lea']);
  });

  it('says plainly when the account is not the home’s admin', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.account = { email: 'guest@example.test', name: null };
    service.issueFailures = [new PairingError('not_admin')];
    renderPage(service, 'fr');

    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: fr.pairConfirmSubmit }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(fr.pairErrorNotAdmin);
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(screen.queryByText(CODE)).toBeNull();
  });

  it('withdraws the code from view once it expires', async () => {
    const user = userEvent.setup();
    let now = NOW;
    const service = new FakePairing();
    service.account = { email: 'lea@example.test', name: null };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage(service, 'en', () => now);
      await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: en.pairConfirmSubmit }));
      expect(await screen.findByText(CODE)).toBeVisible();

      now = NOW + 600_000;
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.queryByText(CODE)).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent(en.pairCodeExpired);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists the home’s keys and revokes one', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.account = { email: 'lea@example.test', name: null };
    renderPage(service, 'en');

    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByText(en.pairKeysTitle));
    await user.click(await screen.findByRole('button', { name: `${en.pairKeysRevoke} Molted agent` }));
    expect(service.revoked).toEqual(['key-a']);
    expect(await screen.findByText(en.pairKeysRevoked)).toBeVisible();
    expect(await screen.findByText(en.pairKeysEmpty)).toBeVisible();
  });

  it('lets the person switch account and forgets the previous choice', async () => {
    const user = userEvent.setup();
    const service = new FakePairing();
    service.account = { email: 'old@example.test', name: null };
    renderPage(service, 'en');

    await user.click(await screen.findByRole('button', { name: /Maison de Léa/u }));
    await user.click(screen.getByRole('button', { name: en.pairSwitchAccount }));
    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('lea@example.test')).toBeVisible();
    expect(screen.getByRole('heading', { name: en.pairHomesTitle })).toBeVisible();
  });
});

describe('/pair route', () => {
  beforeEach(() => window.history.replaceState({}, '', '/pair'));

  it('explains in the page language that a preview cannot pair', async () => {
    const user = userEvent.setup();
    render(<ProductApp initialLocale="en" />);
    expect(screen.getByRole('heading', { name: en.pairUnavailableTitle })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Français/u }));
    expect(screen.getByRole('heading', { name: fr.pairUnavailableTitle })).toBeVisible();
  });

  it('opens the live pairing flow and disposes the service with the app', async () => {
    const service = new FakePairing();
    const { unmount } = render(<ProductApp createPairingService={() => service} initialLocale="fr" />);
    expect(screen.getByRole('heading', { name: fr.pairTitle })).toBeVisible();
    expect(screen.getByRole('button', { name: new RegExp(fr.pairAccountCta, 'u') })).toBeVisible();
    unmount();
    await waitFor(() => expect(service.dispose).toHaveBeenCalled());
  });
});
