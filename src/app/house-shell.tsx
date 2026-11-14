// The trusted shell around a home's own interface.
//
// Miakapp owns the tab bar floating at the bottom of the screen and the profile
// page it opens; the home owns everything in the stage beneath. The bar is rendered by this
// document, outside the house frame, in every state — before consent, after a
// refusal, while loading, after a crash — so going from the home to the
// person's own profile (their homes, their account) is always one tap or one
// keystroke away, whatever the home draws.

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import { parseBarButtons, type AppBarButton, type AppTheme } from '../../component-runtime/src/app-contract';
import {
  HouseCallError,
  mountHouseApp,
  type HouseAppFailureCode,
  type HouseAppLifecycle,
  type HouseAppSession,
} from '../../component-runtime/src/app-host';
import type { ActivatedRelease } from './component-release';
import { safeLocalStorage, type HouseConsentRecord } from './house-consent';
import type { FavoriteHome, HouseFavoritesStore } from './house-favorites';
import {
  failureKey,
  houseTranslator,
  type HouseTranslate,
} from './house-shell-copy';
import { platformGrantCeiling } from './grant-ceiling';
import type {
  HomeConnectionStatus,
  HomeState,
  HomeSummary,
  HouseCallOptions,
  TrustedHost,
} from './host';
import { BarIcon, HomeIcon, StarIcon } from './icons';
import type { Locale } from './copy';
import type { PairingAccount } from './pairing-client';
import { SignInChoices } from './sign-in-choices';

export type MountHouseApp = typeof mountHouseApp;

export type HouseStage =
  | { readonly kind: 'consent' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'app'; readonly release: ActivatedRelease };

export interface HouseShellProps {
  readonly home: HomeSummary;
  readonly homes: readonly HomeSummary[];
  readonly connection: HomeConnectionStatus;
  readonly stage: HouseStage;
  readonly consent: HouseConsentRecord | undefined;
  readonly favorites: HouseFavoritesStore;
  readonly sandboxOrigin: string | undefined;
  readonly homeState: HomeState | undefined;
  readonly call: ((name: string, args: unknown, options: HouseCallOptions) => Promise<unknown>) | undefined;
  readonly reconnect?: (() => void) | undefined;
  readonly signIn?: (() => void) | undefined;
  readonly signInWith?: TrustedHost['signInWith'];
  readonly enablePush?: TrustedHost['enablePush'];
  readonly signInStatus?: 'idle' | 'pending' | 'failed' | undefined;
  readonly signOut?: (() => Promise<void>) | undefined;
  readonly onAcceptConsent: () => void;
  readonly onDeclineConsent: () => void;
  readonly onReopen: () => void;
  readonly onRevokeConsent: () => void;
  readonly onRetry: () => void;
  readonly onSwitchHome: (homeId: string) => void;
  readonly mountHouseApp?: MountHouseApp;
  /** The signed-in account, shown on the profile sheet only. */
  readonly account?: PairingAccount | undefined;
  /** Whether this account owns the open home: adds the home's settings tab. */
  readonly isOwner?: boolean;
  /** Where the home's owner manages it. */
  readonly homeSettingsHref?: string;
}

// ---------------------------------------------------------------------------
// Locale: the shell's own, never the home's.

function readLocale(): Locale {
  return document.documentElement.lang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function subscribeLocale(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => observer.disconnect();
}

/** Follows the page language the product shell sets on `<html lang>`. */
function useShellLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, readLocale, readLocale);
}

// ---------------------------------------------------------------------------
// The home's own bar buttons, kept per home so the next visit shows them before
// the home's interface has started and set them again.

const BAR_KEY = 'miakapp.house-bar.';

function readBarButtons(homeId: string): readonly AppBarButton[] {
  try {
    const raw = safeLocalStorage()?.getItem(BAR_KEY + homeId);
    return raw == null ? [] : parseBarButtons(JSON.parse(raw));
  } catch {
    return [];
  }
}

function useBarButtons(homeId: string): [readonly AppBarButton[], (buttons: readonly AppBarButton[]) => void] {
  const [entry, setEntry] = useState(() => ({ homeId, buttons: readBarButtons(homeId) }));
  const buttons = entry.homeId === homeId ? entry.buttons : readBarButtons(homeId);
  const change = useCallback((next: readonly AppBarButton[]) => {
    setEntry({ homeId, buttons: next });
    try {
      safeLocalStorage()?.setItem(BAR_KEY + homeId, JSON.stringify(next));
    } catch {
      // Shown for this visit only.
    }
  }, [homeId]);
  return [buttons, change];
}

// ---------------------------------------------------------------------------
// Panels

type Panel = 'profile' | undefined;

/** Closes the profile page on Escape and moves focus into it when it opens. */
function useProfileDismissal(
  panel: Panel,
  close: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (panel === undefined) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, close, panelRef]);
}

function HomeAvatar({ home, size = 'md' }: { readonly home: Pick<HomeSummary, 'name' | 'accent'>; readonly size?: 'md' | 'lg' }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`house-avatar house-avatar--${size}`}
      style={{ background: home.accent }}
    >
      {home.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

interface ListedHome {
  readonly id: string;
  readonly name: string;
  readonly accent: string;
  readonly favorite: boolean;
}

const DEFAULT_ACCENT = '#b8d9ff';

function listHomes(
  current: HomeSummary,
  homes: readonly HomeSummary[],
  favorites: readonly FavoriteHome[],
): ListedHome[] {
  const favoriteIds = new Set(favorites.map((home) => home.id));
  const listed = new Map<string, ListedHome>();
  const add = (home: { id: string; name: string; accent?: string | undefined }): void => {
    if (listed.has(home.id)) return;
    listed.set(home.id, {
      id: home.id,
      name: home.name,
      accent: home.accent ?? DEFAULT_ACCENT,
      favorite: favoriteIds.has(home.id),
    });
  };
  add(current);
  for (const home of favorites) add(home);
  for (const home of homes) add(home);
  return [...listed.values()];
}

function HomesList({
  current,
  homes,
  onSwitch,
  onRemoveFavorite,
  onAddFavorite,
  t,
  excludeCurrent = false,
}: {
  readonly current: HomeSummary;
  readonly homes: readonly ListedHome[];
  readonly onSwitch: (homeId: string) => void;
  readonly onRemoveFavorite: (homeId: string) => void;
  readonly onAddFavorite?: (homeId: string) => void;
  readonly t: HouseTranslate;
  readonly excludeCurrent?: boolean;
}): React.JSX.Element {
  const visible = excludeCurrent ? homes.filter((home) => home.id !== current.id) : homes;
  return (
    <ul className="house-homes">
      {visible.map((home) => {
        const isCurrent = home.id === current.id;
        return (
          <li className={isCurrent ? 'house-homes__item is-current' : 'house-homes__item'} key={home.id}>
            <button
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={isCurrent ? `${home.name} · ${t('homesCurrent')}` : t('homesOpen', { home: home.name })}
              className="house-homes__open"
              onClick={() => {
                if (!isCurrent) onSwitch(home.id);
              }}
              type="button"
            >
              <HomeAvatar home={home} />
              <span>{home.name}</span>
              {isCurrent ? <small>{t('homesCurrent')}</small> : null}
            </button>
            {home.favorite ? (
              <button
                aria-label={t('favoriteRemove', { home: home.name })}
                aria-pressed={isCurrent ? 'true' : undefined}
                className="house-icon-button house-icon-button--quiet"
                onClick={() => onRemoveFavorite(home.id)}
                title={t('favoriteRemove', { home: home.name })}
                type="button"
              >
                <StarIcon filled />
              </button>
            ) : isCurrent && onAddFavorite !== undefined ? (
              <button
                aria-label={t('favoriteAdd', { home: home.name })}
                aria-pressed="false"
                className="house-icon-button house-icon-button--quiet"
                onClick={() => onAddFavorite(home.id)}
                title={t('favoriteAdd', { home: home.name })}
                type="button"
              >
                <StarIcon />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Stages

function StagePanel({
  children,
  tone = 'plain',
}: {
  readonly children: React.ReactNode;
  readonly tone?: 'plain' | 'alert';
}): React.JSX.Element {
  return (
    <div className="house-stage__center">
      <section className={`house-card house-card--${tone}`}>{children}</section>
    </div>
  );
}

function ConsentStage({
  home,
  onAccept,
  onDecline,
  t,
}: {
  readonly home: HomeSummary;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly t: HouseTranslate;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <div className="house-stage__center">
      <section aria-labelledby={titleId} className="house-card house-consent">
        <HomeAvatar home={home} size="lg" />
        <p className="house-card__kicker">{t('consentKicker')}</p>
        <h1 id={titleId}>{t('consentTitle', { home: home.name })}</h1>
        <p className="house-card__lede">{t('consentLede')}</p>
        <ul className="house-consent__points">
          <li>{t('consentPointOwner')}</li>
          <li>{t('consentPointIsolation')}</li>
          <li>{t('consentPointMenu')}</li>
        </ul>
        <div className="house-card__actions">
          <button className="house-button" onClick={onAccept} type="button">{t('consentAccept')}</button>
          <button className="house-button house-button--ghost" onClick={onDecline} type="button">
            {t('consentDecline')}
          </button>
        </div>
        <small className="house-card__foot">{t('consentFoot')}</small>
      </section>
    </div>
  );
}

const PENDING_LIFECYCLES: ReadonlySet<HouseAppLifecycle> = new Set(['starting', 'loading']);

/**
 * Mounts the verified release into the stage and keeps it fed. The frame is
 * created by `mountHouseApp`; this component owns only its box, the loading
 * cover and the crash screen that replaces it.
 */
function HouseAppStage({
  call,
  barSelect,
  focusShell,
  home,
  homeState,
  locale,
  mount,
  onBarButtons,
  onRetry,
  onSwitchAway,
  release,
  sandboxOrigin,
  t,
  theme,
}: {
  readonly call: HouseShellProps['call'];
  /** Filled with the running session's way to tell the home a bar button was tapped. */
  readonly barSelect: React.RefObject<((id: string | null) => void) | undefined>;
  readonly focusShell: () => void;
  readonly onBarButtons: (buttons: readonly AppBarButton[]) => void;
  readonly home: HomeSummary;
  readonly homeState: HomeState | undefined;
  readonly locale: Locale;
  readonly mount: MountHouseApp;
  readonly onRetry: () => void;
  readonly onSwitchAway: () => void;
  readonly release: ActivatedRelease;
  readonly sandboxOrigin: string | undefined;
  readonly t: HouseTranslate;
  readonly theme: AppTheme;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<HouseAppSession | undefined>(undefined);
  const [lifecycle, setLifecycle] = useState<HouseAppLifecycle>('starting');
  const [failure, setFailure] = useState<HouseAppFailureCode | undefined>(
    sandboxOrigin === undefined ? 'sandbox_origin_invalid' : undefined,
  );
  // The latest values the mount effect reads without re-mounting on change.
  const latest = useRef({ call, focusShell, homeState, locale, onBarButtons, theme, t });
  useEffect(() => {
    latest.current = { call, focusShell, homeState, locale, onBarButtons, theme, t };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || sandboxOrigin === undefined) return undefined;
    let released = false;
    const controller = new AbortController();
    const current = latest.current;
    setLifecycle('starting');
    setFailure(undefined);

    void mount(
      { pointer: release.pointer, artifact: { bytes: release.artifact.bytes } },
      {
        sandboxOrigin,
        signal: controller.signal,
        container,
        policy: platformGrantCeiling(release.pointer.requires),
        home: { id: home.id, name: home.name },
        title: current.t('frameTitle', { home: home.name }),
        locale: current.locale,
        theme: current.theme,
        ...(current.homeState === undefined ? {} : { initialState: current.homeState }),
        call: async (name, args, options) => {
          if (released) throw new HouseCallError('denied');
          const forward = latest.current.call;
          if (forward === undefined) throw new HouseCallError('unavailable');
          return await forward(name, args, options);
        },
        onLifecycle: (next, code) => {
          if (released) return;
          setLifecycle(next);
          if (code !== undefined) setFailure(code);
        },
        onFocusShell: () => latest.current.focusShell(),
        onBarButtons: (buttons) => latest.current.onBarButtons(buttons),
      },
    ).then(
      (session) => {
        if (released) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
        barSelect.current = (id) => session.selectBarButton(id);
      },
      () => undefined,
    );

    return () => {
      released = true;
      controller.abort();
      sessionRef.current?.dispose();
      sessionRef.current = undefined;
      barSelect.current = undefined;
    };
  }, [barSelect, home.id, home.name, mount, release, sandboxOrigin]);

  useEffect(() => {
    if (homeState === undefined) return;
    sessionRef.current?.publishState(homeState);
  }, [homeState, lifecycle]);

  useEffect(() => {
    sessionRef.current?.setTheme(theme);
  }, [theme]);

  const crashed = failure !== undefined || lifecycle === 'crashed';
  const pending = !crashed && PENDING_LIFECYCLES.has(lifecycle);

  return (
    <div className="house-stage__app">
      <div
        className={pending || crashed ? 'house-stage__frame is-hidden' : 'house-stage__frame'}
        data-testid="house-frame-box"
        ref={containerRef}
      />
      {pending ? (
        <div className="house-stage__cover" role="status">
          <HomeAvatar home={home} size="lg" />
          <span className="house-spinner" aria-hidden="true" />
          <p>{t('loading', { home: home.name })}</p>
        </div>
      ) : null}
      {crashed ? (
        <div className="house-stage__cover house-stage__cover--solid">
          <section className="house-card house-card--alert" role="alert">
            <HomeAvatar home={home} size="lg" />
            <h1>{t('crashTitle', { home: home.name })}</h1>
            <p className="house-card__lede">{t(failureKey(failure ?? 'boot_error'))}</p>
            <div className="house-card__actions">
              <button className="house-button" onClick={onRetry} type="button">{t('crashRetry')}</button>
              <button className="house-button house-button--ghost" onClick={onSwitchAway} type="button">
                {t('switchHome')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell

function connectionText(connection: HomeConnectionStatus, t: HouseTranslate): string | undefined {
  if (connection === 'unavailable') return t('connectionOffline');
  if (connection === 'reconnecting') return t('connectionReconnecting');
  if (connection === 'connecting') return t('connectionConnecting');
  return undefined;
}

function AccountSettings({ account, signOut, t }: {
  readonly account: PairingAccount | undefined;
  readonly signOut: () => Promise<void>;
  readonly t: HouseTranslate;
}): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'pending' | 'failed'>('idle');
  const pending = useRef(false);
  const disconnect = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setStatus('pending');
    try {
      await signOut();
      setStatus('idle');
    } catch {
      setStatus('failed');
    } finally {
      pending.current = false;
    }
  };
  return <section className="house-settings__section">
    <h3>{t('accountSection')}</h3>
    {account === undefined ? null : (
      <div className="house-account">
        <span aria-hidden="true" className="house-account__avatar">{initial(account)}</span>
        <span className="house-account__who">
          <b>{account.name ?? account.email ?? ''}</b>
          {account.name !== null && account.email !== null ? <small>{account.email}</small> : null}
        </span>
      </div>
    )}
    {account?.methods === undefined || account.methods.length === 0 ? null : (
      <p className="house-account__methods">
        {t('signInMethods')}{' '}
        {account.methods.map((method) => methodLabel(method, t)).join(' · ')}
      </p>
    )}
    <button className="house-button house-button--ghost" disabled={status === 'pending'}
      onClick={() => { void disconnect(); }} type="button">
      {t(status === 'pending' ? 'signingOut' : 'signOut')}
    </button>
    {status === 'failed' ? <p role="alert">{t('signOutFailed')}</p> : null}
  </section>;
}

function initial(account: PairingAccount | undefined): string {
  return (account?.name ?? account?.email ?? '').trim().slice(0, 1).toUpperCase() || '·';
}

function methodLabel(method: string, t: HouseTranslate): string {
  if (method === 'google') return 'Google';
  if (method === 'github') return 'GitHub';
  if (method === 'email') return t('signInMethodEmail');
  return method;
}

function PushSettings({ enablePush, t }: {
  readonly enablePush: () => Promise<void>;
  readonly t: HouseTranslate;
}): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'failed'>('idle');
  const enable = async (): Promise<void> => {
    setStatus('pending');
    try {
      await enablePush();
      setStatus('done');
    } catch {
      setStatus('failed');
    }
  };
  return <section className="house-settings__section">
    <h3>{t('pushSection')}</h3>
    {status === 'done' ? <p role="status">{t('pushEnabled')}</p> : (
      <button className="house-button house-button--ghost" disabled={status === 'pending'}
        onClick={() => { void enable(); }} type="button">
        {t(status === 'pending' ? 'pushEnabling' : 'pushEnable')}
      </button>
    )}
    {status === 'failed' ? <p role="alert">{t('pushFailed')}</p> : null}
  </section>;
}

export function HouseShell(props: HouseShellProps): React.JSX.Element {
  const {
    consent,
    connection,
    favorites,
    home,
    homes,
    stage,
    onSwitchHome,
  } = props;
  const locale = useShellLocale();
  const t = useCallback<HouseTranslate>((key, values) => houseTranslator(locale)(key, values), [locale]);
  // The home follows the device; Miakapp offers no appearance setting of its own.
  const theme: AppTheme = 'system';
  const [panel, setPanel] = useState<Panel>(undefined);
  const favoriteList = useSyncExternalStore(favorites.subscribe, favorites.list, favorites.list);
  const [restartKey, setRestartKey] = useState(0);
  const homeButton = useRef<HTMLButtonElement | null>(null);
  const profileButton = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const [barButtons, setBarButtons] = useBarButtons(home.id);
  const [selected, setSelected] = useState<string | null>(
    () => barButtons.find((button) => button.active)?.id ?? null,
  );
  const barSelect = useRef<((id: string | null) => void) | undefined>(undefined);
  const receiveBarButtons = useCallback((buttons: readonly AppBarButton[]) => {
    setBarButtons(buttons);
    setSelected((current) => buttons.find((button) => button.active)?.id
      ?? (buttons.some((button) => button.id === current) ? current : null));
  }, [setBarButtons]);
  const select = (id: string | null): void => {
    setPanel(undefined);
    setSelected(id);
    barSelect.current?.(id);
  };
  // Shown while the home's interface starts and runs, never before consent.
  const homeButtons = stage.kind === 'app' || stage.kind === 'loading' ? barButtons : [];
  const current = homeButtons.some((button) => button.id === selected) ? selected : null;

  const close = useCallback(() => {
    setPanel((open) => {
      if (open === 'profile') profileButton.current?.focus();
      return undefined;
    });
  }, []);
  useProfileDismissal(panel, close, panelRef);

  const focusShell = useCallback(() => {
    homeButton.current?.focus();
  }, []);

  const addFavorite = (): void => { favorites.add({ id: home.id, name: home.name, accent: home.accent }); };
  const removeFavorite = (homeId: string): void => { favorites.remove(homeId); };
  const listed = listHomes(home, homes, favoriteList);
  // Before consent and identity, no home connection has been attempted.
  const connectionObservable = !['consent', 'declined', 'signin'].includes(stage.kind);
  const status = connectionObservable ? connectionText(connection, t) : undefined;
  const openHomes = (): void => setPanel((open) => (open === 'profile' ? undefined : 'profile'));

  const consentDate = consent === undefined
    ? undefined
    : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(consent.grantedAt);

  return (
    <div className="house-shell" data-stage={stage.kind}>
      <main className="house-stage">
        {stage.kind === 'consent' ? (
          <ConsentStage home={home} onAccept={props.onAcceptConsent} onDecline={props.onDeclineConsent} t={t} />
        ) : stage.kind === 'declined' ? (
          <StagePanel>
            <HomeAvatar home={home} size="lg" />
            <h1>{t('declinedTitle', { home: home.name })}</h1>
            <p className="house-card__lede">{t('declinedLede')}</p>
            <div className="house-card__actions">
              <button className="house-button" onClick={props.onReopen} type="button">{t('declinedReopen')}</button>
            </div>
            {listed.length > 1 ? (
              <>
                <h2 className="house-card__subhead">{t('declinedOther')}</h2>
                <HomesList
                  current={home}
                  excludeCurrent
                  homes={listed}
                  onRemoveFavorite={removeFavorite}
                  onSwitch={onSwitchHome}
                  t={t}
                />
              </>
            ) : null}
          </StagePanel>
        ) : stage.kind === 'signin' ? (
          <StagePanel>
            <HomeAvatar home={home} size="lg" />
            <h1>{t('signInTitle', { home: home.name })}</h1>
            <p className="house-card__lede">{t('signInLede')}</p>
            {props.signInStatus === 'failed' ? <p role="alert">{t('signInFailed')}</p> : null}
            {props.signInWith !== undefined ? (
              <SignInChoices locale={locale} signIn={props.signInWith} />
            ) : (
              <div className="house-card__actions">
                <button
                  className="house-button"
                  disabled={props.signIn === undefined || props.signInStatus === 'pending'}
                  onClick={props.signIn}
                  type="button"
                >
                  {t(props.signInStatus === 'pending' ? 'signingIn' : 'signInAction')}
                </button>
              </div>
            )}
          </StagePanel>
        ) : stage.kind === 'empty' ? (
          <StagePanel>
            <HomeAvatar home={home} size="lg" />
            <h1>{t('emptyTitle', { home: home.name })}</h1>
            <p className="house-card__lede">{t('emptyLede')}</p>
            <div className="house-card__actions">
              <button className="house-button house-button--ghost" onClick={openHomes} type="button">
                {t('switchHome')}
              </button>
            </div>
          </StagePanel>
        ) : stage.kind === 'loading' ? (
          <div className="house-stage__cover" role="status">
            <HomeAvatar home={home} size="lg" />
            <span className="house-spinner" aria-hidden="true" />
            <p>{t('loading', { home: home.name })}</p>
          </div>
        ) : stage.kind === 'unavailable' ? (
          <StagePanel tone="alert">
            <HomeAvatar home={home} size="lg" />
            <h1>{t('unavailableTitle', { home: home.name })}</h1>
            <p className="house-card__lede">{t('unavailableLede')}</p>
            <div className="house-card__actions">
              <button className="house-button" onClick={props.onRetry} type="button">{t('crashRetry')}</button>
              <button className="house-button house-button--ghost" onClick={openHomes} type="button">
                {t('switchHome')}
              </button>
            </div>
          </StagePanel>
        ) : (
          <HouseAppStage
            barSelect={barSelect}
            call={props.call}
            focusShell={focusShell}
            home={home}
            homeState={props.homeState}
            key={restartKey}
            locale={locale}
            mount={props.mountHouseApp ?? mountHouseApp}
            onBarButtons={receiveBarButtons}
            onRetry={() => setRestartKey((key) => key + 1)}
            onSwitchAway={openHomes}
            release={stage.release}
            sandboxOrigin={props.sandboxOrigin}
            t={t}
            theme={theme}
          />
        )}
      </main>

      {panel === undefined ? null : (
        <section
          aria-label={t('profileTitle')}
          className="house-profile"
          id={panelId}
          ref={panelRef}
          tabIndex={-1}
        >
          <div className="house-profile__inner">
            <h1 className="house-profile__title">{t('profileTitle')}</h1>
            <div className="house-settings">
              {props.signOut === undefined ? null : (
                <AccountSettings account={props.account} signOut={props.signOut} t={t} />
              )}
              <section className="house-settings__section">
                <h3>{t('homesTitle')}</h3>
                <HomesList
                  current={home}
                  homes={listed}
                  onAddFavorite={addFavorite}
                  onRemoveFavorite={removeFavorite}
                  onSwitch={onSwitchHome}
                  t={t}
                />
                {listed.length < 2 ? <p className="house-panel__hint">{t('homesEmpty')}</p> : null}
              </section>
              {props.enablePush === undefined ? null : <PushSettings enablePush={props.enablePush} t={t} />}
              {consent === undefined && stage.kind !== 'app' && props.isOwner !== true ? null : (
                <section className="house-settings__section">
                  <h3>{t('consentSection')}</h3>
                  {consentDate === undefined ? null : <p>{t('consentGrantedOn', { date: consentDate })}</p>}
                  <div className="house-settings__actions">
                    {stage.kind === 'app' ? (
                      <button
                        className="house-button house-button--ghost"
                        onClick={() => {
                          setRestartKey((key) => key + 1);
                          close();
                        }}
                        type="button"
                      >
                        {t('reload')}
                      </button>
                    ) : null}
                    {props.isOwner === true ? (
                      <a className="house-button house-button--ghost" href={props.homeSettingsHref ?? '/pair'}
                        rel="noopener" target="_blank">
                        {t('homeSettings')}
                      </a>
                    ) : null}
                    {consent === undefined ? null : (
                      <button
                        className="house-button house-button--danger"
                        onClick={() => {
                          setPanel(undefined);
                          props.onRevokeConsent();
                        }}
                        type="button"
                      >
                        {t('consentRevoke')}
                      </button>
                    )}
                  </div>
                </section>
              )}
              <p className="house-panel__hint">{t('shortcutHint')}</p>
            </div>
          </div>
        </section>
      )}

      <div className="house-dock">
        {status === undefined ? null : (
          <span className={`house-bar__status house-bar__status--${connection}`} role="status">
            <span>{status}</span>
            {connection === 'unavailable' && props.reconnect !== undefined ? (
              <button aria-label={t('connectionRetryLabel')} className="house-bar__retry"
                onClick={props.reconnect} type="button">{t('connectionRetry')}</button>
            ) : null}
          </span>
        )}
        <nav aria-label={t('barLabel')} className="house-bar">
          <button
            aria-current={panel === undefined && current === null ? 'page' : undefined}
            className="house-bar__tab house-bar__tab--home"
            onClick={() => select(null)}
            ref={homeButton}
            title={home.name}
            type="button"
          >
            <HomeIcon />
            <span className="house-bar__label">{home.name}</span>
          </button>
          {homeButtons.length === 0 ? null : (
            <span className="house-bar__home-buttons">
              {homeButtons.map((button) => (
                <button
                  aria-current={panel === undefined && current === button.id ? 'page' : undefined}
                  className="house-bar__tab"
                  key={button.id}
                  onClick={() => select(button.id)}
                  type="button"
                >
                  <BarIcon name={button.icon} />
                  <span className="house-bar__label">{button.label}</span>
                </button>
              ))}
            </span>
          )}
          <button
            aria-controls={panel === 'profile' ? panelId : undefined}
            aria-current={panel === 'profile' ? 'page' : undefined}
            aria-expanded={panel === 'profile'}
            className="house-bar__tab"
            onClick={openHomes}
            ref={profileButton}
            type="button"
          >
            <span aria-hidden="true" className="house-bar__me">{initial(props.account)}</span>
            <span className="house-bar__label">{t('profile')}</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
