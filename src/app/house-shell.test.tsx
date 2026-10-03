import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type {
  HouseAppHostOptions,
  HouseAppRelease,
  HouseAppSession,
} from '../../component-runtime/src/app-host';
import { APP_ABI, POINTER_SCHEMA } from '../../component-runtime/src/contract';
import { App } from './app';
import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import { NoPublishedRelease } from './component-release';
import { createDemoHost } from './demo-host';
import type { HomeState, TrustedHost, TrustedHostSnapshot } from './host';
import { createHouseConsentStore, HOUSE_CONSENT_VERSION } from './house-consent';
import { createHouseFavoritesStore } from './house-favorites';
import type { MountHouseApp } from './house-shell';

const SANDBOX_ORIGIN = 'https://sandbox.miakapp.test';
const HOME_ID = 'home_horizon';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function appRelease(): ActivatedRelease {
  const bytes = new TextEncoder().encode('document.body.textContent = "house";');
  return {
    pointer: {
      schema: POINTER_SCHEMA,
      home_id: HOME_ID,
      generation: 2,
      release: 'house-2',
      abi: APP_ABI,
      url: 'https://artifacts.miakapp.test/house.js',
      sha256: 'A'.repeat(43),
      size: bytes.byteLength,
      requires: { state_read: ['zone.*'], event_subscribe: [], event_publish: [], call: ['lighting.set'], presentation: [] },
    },
    artifact: { bytes, sha256: 'A'.repeat(43), size: bytes.byteLength } as unknown as ActivatedRelease['artifact'],
    fellBack: false,
  };
}

interface FakeSession extends HouseAppSession {
  readonly publishState: Mock<HouseAppSession['publishState']>;
  readonly setTheme: Mock<HouseAppSession['setTheme']>;
  readonly dispose: Mock<HouseAppSession['dispose']>;
}

interface FakeMount {
  readonly mount: Mock<MountHouseApp>;
  readonly sessions: FakeSession[];
  readonly options: HouseAppHostOptions[];
}

/** Stands in for `mountHouseApp`: appends a frame where the real one would. */
function fakeMount(): FakeMount {
  const sessions: FakeMount['sessions'] = [];
  const options: HouseAppHostOptions[] = [];
  const mount = vi.fn<MountHouseApp>(async (_release: HouseAppRelease, mountOptions: HouseAppHostOptions) => {
    options.push(mountOptions);
    const frame = document.createElement('iframe');
    frame.className = 'house-app-frame';
    frame.title = mountOptions.title;
    mountOptions.container.append(frame);
    mountOptions.onLifecycle('starting');
    const session: FakeSession = {
      lifecycle: 'loading',
      frame,
      publishState: vi.fn<HouseAppSession['publishState']>(),
      setTheme: vi.fn<HouseAppSession['setTheme']>(),
      dispose: vi.fn<HouseAppSession['dispose']>(() => frame.remove()),
    };
    sessions.push(session);
    mountOptions.onLifecycle('loading');
    return session;
  });
  return { mount, sessions, options };
}

function coordinatorFor(release: ActivatedRelease | Error = appRelease()): {
  activate: Mock<ComponentReleaseCoordinator['activate']>;
} {
  return {
    activate: vi.fn<ComponentReleaseCoordinator['activate']>(async () => {
      if (release instanceof Error) throw release;
      return release;
    }),
  };
}

function hostWith(patch: Partial<TrustedHostSnapshot> = {}, call?: TrustedHost['call']): TrustedHost {
  const base = createDemoHost();
  const snapshot = { ...base.getSnapshot(), ...patch };
  return { ...base, getSnapshot: () => snapshot, ...(call === undefined ? {} : { call }) };
}

beforeEach(() => {
  document.documentElement.lang = 'fr';
});

afterEach(() => {
  document.documentElement.lang = '';
});

describe('house shell — consent before any house resource', () => {
  it('loads nothing of the home before the resident agrees, while the Miakapp menu works', async () => {
    const user = userEvent.setup();
    const coordinator = coordinatorFor();
    const { mount } = fakeMount();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <App
        consentStore={createHouseConsentStore(memoryStorage())}
        createComponentRelease={() => coordinator}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ouvrir Horizon House ?' })).toBeVisible();
    expect(screen.getByText(/créée et gérée par la personne qui s’en occupe/u)).toBeVisible();

    // The overlay is usable before consent: homes and personal settings.
    await user.click(screen.getByRole('button', { name: /Menu Miakapp/u }));
    expect(screen.getByRole('dialog', { name: 'Maisons' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Menu Miakapp/u })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeVisible();

    // Zero house loads: no pointer read, no artifact, no frame, no request.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(coordinator.activate).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('opens the home after agreement, in the stage and never inside the Miakapp bar', async () => {
    const user = userEvent.setup();
    const consentStorage = memoryStorage();
    const coordinator = coordinatorFor();
    const { mount, options } = fakeMount();
    render(
      <App
        consentStore={createHouseConsentStore(consentStorage, () => 1_790_000_000_000)}
        createComponentRelease={() => coordinator}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ouvrir la maison' }));

    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(coordinator.activate).toHaveBeenCalledOnce();
    const [release, mountOptions] = mount.mock.calls[0] as [HouseAppRelease, HouseAppHostOptions];
    expect(release.pointer.abi).toBe(APP_ABI);
    expect(mountOptions.sandboxOrigin).toBe(SANDBOX_ORIGIN);
    expect(mountOptions.home).toEqual({ id: HOME_ID, name: 'Horizon House' });
    expect(mountOptions.title).toBe('Interface de Horizon House');
    expect(options[0]!.container.closest('main.house-stage')).not.toBeNull();
    expect(options[0]!.container.closest('header')).toBeNull();
    const frame = document.querySelector('iframe')!;
    expect(screen.getByRole('banner', { name: 'Miakapp' }).contains(frame)).toBe(false);

    // The agreement is kept for this home, at the current notice version.
    expect(JSON.parse(consentStorage.getItem('miakapp.house-consent')!)).toEqual({
      [HOME_ID]: { version: HOUSE_CONSENT_VERSION, grantedAt: 1_790_000_000_000 },
    });
  });

  it('asks again when the notice version changed, and not when it did not', () => {
    const storage = memoryStorage();
    storage.setItem('miakapp.house-consent', JSON.stringify({ [HOME_ID]: { version: 0, grantedAt: 1 } }));
    const stale = render(
      <App
        consentStore={createHouseConsentStore(storage)}
        createComponentRelease={() => coordinatorFor()}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={fakeMount().mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ouvrir la maison' })).toBeVisible();
    stale.unmount();

    storage.setItem('miakapp.house-consent', JSON.stringify({ [HOME_ID]: { version: HOUSE_CONSENT_VERSION, grantedAt: 1 } }));
    const coordinator = coordinatorFor();
    render(
      <App
        consentStore={createHouseConsentStore(storage)}
        createComponentRelease={() => coordinator}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={fakeMount().mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ouvrir la maison' })).not.toBeInTheDocument();
    expect(coordinator.activate).toHaveBeenCalledOnce();
  });

  it('declining loads nothing and leads back to the other homes', async () => {
    const user = userEvent.setup();
    const switchHome = vi.fn();
    const favorites = createHouseFavoritesStore(memoryStorage());
    favorites.add({ id: 'chalet-annecy', name: 'Chalet d’Annecy', accent: '#ff8d6b' });
    const coordinator = coordinatorFor();
    const { mount } = fakeMount();
    render(
      <App
        consentStore={createHouseConsentStore(memoryStorage())}
        createComponentRelease={() => coordinator}
        favoritesStore={favorites}
        mountHouseApp={mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
        switchHome={switchHome}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pas maintenant' }));

    expect(screen.getByRole('heading', { name: 'Horizon House n’a pas été ouverte' })).toBeVisible();
    expect(screen.getByText('Aucun contenu de cette maison n’a été chargé.')).toBeVisible();
    expect(coordinator.activate).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Ouvrir Chalet d’Annecy' }));
    expect(switchHome).toHaveBeenCalledWith('chalet-annecy');

    await user.click(screen.getByRole('button', { name: 'Ouvrir quand même' }));
    expect(screen.getByRole('button', { name: 'Ouvrir la maison' })).toBeVisible();
  });

  it('withdrawing the agreement unloads the home and asks again', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    const consent = createHouseConsentStore(storage);
    consent.grant(HOME_ID);
    const { mount, sessions } = fakeMount();
    render(
      <App
        consentStore={consent}
        createComponentRelease={() => coordinatorFor()}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    await user.click(screen.getByRole('button', { name: 'Retirer mon accord' }));

    expect(sessions[0]!.dispose).toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ouvrir la maison' })).toBeVisible();
    expect(consent.read(HOME_ID)).toBeUndefined();
  });

  it('asks a signed-out resident to sign in before requesting anything', () => {
    const coordinator = coordinatorFor();
    const consent = createHouseConsentStore(memoryStorage());
    consent.grant(HOME_ID);
    const signIn = vi.fn();
    render(
      <App
        consentStore={consent}
        createComponentRelease={() => coordinator}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        host={{ ...hostWith({ signInAvailable: true, authenticated: false }), signIn }}
        mountHouseApp={fakeMount().mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Connectez-vous pour ouvrir Horizon House' })).toBeVisible();
    expect(coordinator.activate).not.toHaveBeenCalled();
  });

  it('says, under the home’s public name, that nothing is published yet', async () => {
    const consent = createHouseConsentStore(memoryStorage());
    consent.grant(HOME_ID);
    render(
      <App
        consentStore={consent}
        createComponentRelease={() => coordinatorFor(new NoPublishedRelease('Chalet d’Annecy'))}
        favoritesStore={createHouseFavoritesStore(memoryStorage())}
        mountHouseApp={fakeMount().mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Chalet d’Annecy n’a pas encore d’interface' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Menu Miakapp/u })).toHaveTextContent('Chalet d’Annecy');
    // No platform-made home screen stands in for the home's own.
    expect(screen.queryByText('3 lights on')).toBeNull();
  });
});

describe('house shell — around a running home', () => {
  function renderRunning(patch: Partial<TrustedHostSnapshot> = {}, call?: TrustedHost['call']) {
    const consent = createHouseConsentStore(memoryStorage());
    consent.grant(HOME_ID);
    const fake = fakeMount();
    const favorites = createHouseFavoritesStore(memoryStorage());
    const view = render(
      <App
        consentStore={consent}
        createComponentRelease={() => coordinatorFor()}
        favoritesStore={favorites}
        host={hostWith(patch, call)}
        mountHouseApp={fake.mount}
        readSandboxOrigin={() => SANDBOX_ORIGIN}
      />,
    );
    return { ...fake, favorites, view };
  }

  it('replaces a crashed home with the shell’s own words and restarts it on request', async () => {
    const user = userEvent.setup();
    const { mount, options } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    act(() => options[0]!.onLifecycle('crashed', 'unresponsive'));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'L’interface de Horizon House s’est arrêtée' })).toBeVisible();
    expect(within(alert).getByText('Elle ne répondait plus.')).toBeVisible();
    // The overlay is still there and still answers.
    await user.click(screen.getByRole('button', { name: /Menu Miakapp/u }));
    expect(screen.getByRole('dialog', { name: 'Maisons' })).toBeVisible();
    await user.keyboard('{Escape}');

    await user.click(within(alert).getByRole('button', { name: 'Relancer' }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
  });

  it('hides the loading cover once the home is ready', async () => {
    const { mount, options } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Ouverture de Horizon House…');
    act(() => options[0]!.onLifecycle('active'));
    expect(screen.queryByText('Ouverture de Horizon House…')).not.toBeInTheDocument();
    expect(screen.getByTestId('house-frame-box')).not.toHaveClass('is-hidden');
  });

  it('feeds the running home the state the shell holds and forwards its calls to the host', async () => {
    const homeState: HomeState = { values: { 'zone.living.on': true }, revision: 7, stale: false };
    const call = vi.fn(async () => ({ applied: true }));
    const { mount, options, sessions } = renderRunning({ homeState }, call);
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(options[0]!.initialState).toEqual(homeState);
    await waitFor(() => expect(sessions[0]!.publishState).toHaveBeenCalledWith(homeState));

    const controller = new AbortController();
    await expect(options[0]!.call('lighting.set', { on: true }, { timeoutMs: 1_000, signal: controller.signal }))
      .resolves.toEqual({ applied: true });
    expect(call).toHaveBeenCalledWith('lighting.set', { on: true }, { timeoutMs: 1_000, signal: controller.signal });
  });

  it('refuses calls when the host cannot reach a coordinator', async () => {
    const { mount, options } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    await expect(options[0]!.call('lighting.set', null, { timeoutMs: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('moves focus to the Miakapp menu when the home asks for the way back', async () => {
    const { mount, options } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    act(() => options[0]!.onFocusShell!());
    expect(screen.getByRole('button', { name: /Menu Miakapp/u })).toHaveFocus();
  });

  it('keeps favorites in the shell and lets the resident remove them', async () => {
    const user = userEvent.setup();
    const { favorites } = renderRunning();
    const star = screen.getByRole('button', { name: 'Ajouter Horizon House aux favoris' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    expect(screen.getByRole('button', { name: 'Retirer Horizon House des favoris' })).toHaveAttribute('aria-pressed', 'true');
    expect(favorites.list().map((home) => home.id)).toEqual([HOME_ID]);

    await user.click(screen.getByRole('button', { name: /Menu Miakapp/u }));
    const panel = screen.getByRole('dialog', { name: 'Maisons' });
    await user.click(within(panel).getByRole('button', { name: 'Retirer Horizon House des favoris' }));
    expect(favorites.list()).toEqual([]);
  });

  it('hands the home a theme the resident picks in the shell', async () => {
    const user = userEvent.setup();
    const { mount, sessions } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    await user.click(screen.getByRole('radio', { name: 'Sombre' }));
    expect(sessions[0]!.setTheme).toHaveBeenLastCalledWith('dark');
  });

  it('closes a panel when focus moves into the home', async () => {
    const user = userEvent.setup();
    renderRunning();
    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never shows the platform’s technical labels around a home’s interface', async () => {
    const { mount } = renderRunning();
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const text = document.body.textContent ?? '';
    for (const jargon of ['ABI', 'Semantic host', 'relay', 'ACCEPTED', 'Component']) {
      expect(text).not.toContain(jargon);
    }
  });
});
