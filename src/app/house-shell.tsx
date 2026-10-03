// The trusted shell around a home's own interface.
//
// Miakapp owns a slim bar and the panels it opens; the home owns everything in
// the stage below. The bar is rendered by this document, outside the house
// frame, in every state — before consent, after a refusal, while loading, after
// a crash — so switching homes, personal settings and favorites are always one
// tap or one keystroke away, whatever the home draws.

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import type { AppTheme } from '../../component-runtime/src/app-contract';
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
  type HouseCopyKey,
  type HouseTranslate,
} from './house-shell-copy';
import { platformGrantCeiling } from './grant-ceiling';
import type {
  HomeConnectionStatus,
  HomeState,
  HomeSummary,
  HouseCallOptions,
  SemanticInteraction,
} from './host';
import { SemanticRenderer } from './semantic-renderer';
import { ChevronDownIcon, CloseIcon, SettingsIcon, SparkIcon, StarIcon } from './icons';
import type { Locale } from './copy';

export type MountHouseApp = typeof mountHouseApp;

export type HouseStage =
  | { readonly kind: 'consent' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'app'; readonly release: ActivatedRelease }
  | { readonly kind: 'component'; readonly release: ActivatedRelease };

/** The semantic runtime as the App drives it; the shell only draws it. */
export type ComponentScreenState =
  | { readonly status: 'idle' | 'starting' }
  | { readonly status: 'active'; readonly tree: unknown; readonly revision: number }
  | { readonly status: 'failed'; readonly code: string };

export interface ComponentScreen {
  readonly state: ComponentScreenState;
  readonly interact: (interaction: SemanticInteraction) => void;
}

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
  readonly signIn?: (() => void) | undefined;
  readonly onAcceptConsent: () => void;
  readonly onDeclineConsent: () => void;
  readonly onReopen: () => void;
  readonly onRevokeConsent: () => void;
  readonly onRetry: () => void;
  readonly onSwitchHome: (homeId: string) => void;
  readonly mountHouseApp?: MountHouseApp;
  readonly componentScreen?: ComponentScreen;
}

// ---------------------------------------------------------------------------
// Locale and theme: the shell's own, never the home's.

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

const THEME_KEY = 'miakapp.house-theme';
const THEMES: readonly AppTheme[] = ['system', 'light', 'dark'];

function readTheme(): AppTheme {
  try {
    const value = safeLocalStorage()?.getItem(THEME_KEY);
    return THEMES.includes(value as AppTheme) ? value as AppTheme : 'system';
  } catch {
    return 'system';
  }
}

function useHouseTheme(): [AppTheme, (theme: AppTheme) => void] {
  const [theme, setTheme] = useState<AppTheme>(readTheme);
  const change = useCallback((next: AppTheme) => {
    setTheme(next);
    try {
      safeLocalStorage()?.setItem(THEME_KEY, next);
    } catch {
      // The preference still applies for this page.
    }
  }, []);
  return [theme, change];
}

// ---------------------------------------------------------------------------
// Panels

type Panel = 'homes' | 'settings' | undefined;

/**
 * Closes the open panel on Escape, on a press outside it, and when focus leaves
 * this document — which is what happens when the person taps into the home's
 * frame. Focus returns to the control that opened it.
 */
function usePanelDismissal(
  panel: Panel,
  close: () => void,
  panelRef: React.RefObject<HTMLDivElement | null>,
  triggers: readonly React.RefObject<HTMLButtonElement | null>[],
): void {
  useEffect(() => {
    if (panel === undefined) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (triggers.some((trigger) => trigger.current?.contains(target))) return;
      close();
    };
    const onBlur = (): void => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('blur', onBlur);
    panelRef.current?.querySelector<HTMLElement>('button, [href]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('blur', onBlur);
    };
  }, [panel, close, panelRef, triggers]);
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
  t,
  excludeCurrent = false,
}: {
  readonly current: HomeSummary;
  readonly homes: readonly ListedHome[];
  readonly onSwitch: (homeId: string) => void;
  readonly onRemoveFavorite: (homeId: string) => void;
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
                className="house-icon-button house-icon-button--quiet"
                onClick={() => onRemoveFavorite(home.id)}
                title={t('favoriteRemove', { home: home.name })}
                type="button"
              >
                <StarIcon filled />
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
  focusShell,
  home,
  homeState,
  locale,
  mount,
  onRetry,
  onSwitchAway,
  release,
  sandboxOrigin,
  t,
  theme,
}: {
  readonly call: HouseShellProps['call'];
  readonly focusShell: () => void;
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
  const latest = useRef({ call, focusShell, homeState, locale, theme, t });
  useEffect(() => {
    latest.current = { call, focusShell, homeState, locale, theme, t };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || sandboxOrigin === undefined) return undefined;
    let released = false;
    const current = latest.current;
    setLifecycle('starting');
    setFailure(undefined);

    void mount(
      { pointer: release.pointer, artifact: { bytes: release.artifact.bytes } },
      {
        sandboxOrigin,
        container,
        policy: platformGrantCeiling(release.pointer.requires),
        home: { id: home.id, name: home.name },
        title: current.t('frameTitle', { home: home.name }),
        locale: current.locale,
        theme: current.theme,
        ...(current.homeState === undefined ? {} : { initialState: current.homeState }),
        call: async (name, args, options) => {
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
      },
    ).then(
      (session) => {
        if (released) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
      },
      () => undefined,
    );

    return () => {
      released = true;
      sessionRef.current?.dispose();
      sessionRef.current = undefined;
    };
  }, [home.id, home.name, mount, release, sandboxOrigin]);

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

/** Shell words for the runtime's classified codes; never the component's text. */
function componentFailureKey(code: string): HouseCopyKey {
  if (code === 'sandbox_missing') return 'failure_sandbox_origin_invalid';
  if (code === 'ready_timeout' || code === 'mount_failed') return 'failure_sandbox_unreachable';
  if (code.includes('unresponsive')) return 'failure_unresponsive';
  return 'failure_boot_error';
}

/**
 * A semantic component's screen: the tree comes back from the sandboxed
 * runtime as data and is redrawn here with Miakapp's own controls.
 */
function ComponentStage({
  home,
  locale,
  onRetry,
  onSwitchAway,
  screen,
  t,
}: {
  readonly home: HomeSummary;
  readonly locale: Locale;
  readonly onRetry: () => void;
  readonly onSwitchAway: () => void;
  readonly screen: ComponentScreen | undefined;
  readonly t: HouseTranslate;
}): React.JSX.Element {
  const state = screen?.state ?? { status: 'idle' };
  if (state.status === 'active') {
    return (
      <div className="house-stage__semantic">
        <SemanticRenderer locale={locale} onInteraction={screen!.interact} tree={state.tree} />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <div className="house-stage__cover house-stage__cover--solid">
        <section className="house-card house-card--alert" role="alert">
          <HomeAvatar home={home} size="lg" />
          <h1>{t('crashTitle', { home: home.name })}</h1>
          <p className="house-card__lede">{t(componentFailureKey(state.code))}</p>
          <div className="house-card__actions">
            <button className="house-button" onClick={onRetry} type="button">{t('crashRetry')}</button>
            <button className="house-button house-button--ghost" onClick={onSwitchAway} type="button">
              {t('switchHome')}
            </button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="house-stage__cover" role="status">
      <HomeAvatar home={home} size="lg" />
      <span className="house-spinner" aria-hidden="true" />
      <p>{t('loading', { home: home.name })}</p>
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
  const [theme, setTheme] = useHouseTheme();
  const [panel, setPanel] = useState<Panel>(undefined);
  const [favoriteList, setFavoriteList] = useState<readonly FavoriteHome[]>(() => favorites.list());
  const [restartKey, setRestartKey] = useState(0);
  const homeButton = useRef<HTMLButtonElement | null>(null);
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [triggers] = useState(() => [homeButton, settingsButton] as const);
  const panelId = useId();

  const close = useCallback(() => {
    setPanel((open) => {
      if (open === 'homes') homeButton.current?.focus();
      if (open === 'settings') settingsButton.current?.focus();
      return undefined;
    });
  }, []);
  usePanelDismissal(panel, close, panelRef, triggers);

  const focusShell = useCallback(() => {
    homeButton.current?.focus();
  }, []);

  const isFavorite = favoriteList.some((entry) => entry.id === home.id);
  const toggleFavorite = (): void => {
    setFavoriteList(isFavorite
      ? favorites.remove(home.id)
      : favorites.add({ id: home.id, name: home.name, accent: home.accent }));
  };
  const removeFavorite = (homeId: string): void => setFavoriteList(favorites.remove(homeId));
  const listed = listHomes(home, homes, favoriteList);
  // Before consent and identity, no home connection has been attempted.
  const connectionObservable = !['consent', 'declined', 'signin'].includes(stage.kind);
  const status = connectionObservable ? connectionText(connection, t) : undefined;
  const openHomes = (): void => setPanel((open) => (open === 'homes' ? undefined : 'homes'));

  const consentDate = consent === undefined
    ? undefined
    : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(consent.grantedAt);

  return (
    <div className="house-shell" data-stage={stage.kind}>
      <header aria-label={t('barLabel')} className="house-bar">
        <button
          aria-controls={panel === 'homes' ? panelId : undefined}
          aria-expanded={panel === 'homes'}
          aria-haspopup="dialog"
          className="house-bar__home"
          onClick={openHomes}
          ref={homeButton}
          type="button"
        >
          <span className="house-bar__mark" aria-hidden="true"><SparkIcon /></span>
          <span className="visually-hidden">{t('menuLabel')}</span>
          <HomeAvatar home={home} />
          <span className="house-bar__name">{home.name}</span>
          <ChevronDownIcon className="house-bar__chevron" />
        </button>
        {status === undefined ? null : (
          <span className={`house-bar__status house-bar__status--${connection}`} role="status">{status}</span>
        )}
        <div className="house-bar__actions">
          <button
            aria-label={isFavorite ? t('favoriteRemove', { home: home.name }) : t('favoriteAdd', { home: home.name })}
            aria-pressed={isFavorite}
            className="house-icon-button"
            onClick={toggleFavorite}
            title={isFavorite ? t('favoriteRemove', { home: home.name }) : t('favoriteAdd', { home: home.name })}
            type="button"
          >
            <StarIcon filled={isFavorite} />
          </button>
          <button
            aria-controls={panel === 'settings' ? panelId : undefined}
            aria-expanded={panel === 'settings'}
            aria-haspopup="dialog"
            aria-label={t('settings')}
            className="house-icon-button"
            onClick={() => setPanel((open) => (open === 'settings' ? undefined : 'settings'))}
            ref={settingsButton}
            title={t('settings')}
            type="button"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {panel === undefined ? null : <div aria-hidden="true" className="house-scrim" />}
      {panel === undefined ? null : (
        <div
          aria-label={panel === 'homes' ? t('homesTitle') : t('settingsTitle')}
          className={`house-panel house-panel--${panel}`}
          id={panelId}
          ref={panelRef}
          role="dialog"
        >
          <header className="house-panel__head">
            <h2>{panel === 'homes' ? t('homesTitle') : t('settingsTitle')}</h2>
            <button aria-label={t('close')} className="house-icon-button house-icon-button--quiet" onClick={close} type="button">
              <CloseIcon />
            </button>
          </header>
          {panel === 'homes' ? (
            <>
              <HomesList
                current={home}
                homes={listed}
                onRemoveFavorite={removeFavorite}
                onSwitch={onSwitchHome}
                t={t}
              />
              {favoriteList.length === 0 ? <p className="house-panel__hint">{t('homesEmpty')}</p> : null}
            </>
          ) : (
            <div className="house-settings">
              <fieldset className="house-segmented">
                <legend>{t('themeLabel')}</legend>
                {THEMES.map((option) => (
                  <label className={theme === option ? 'is-active' : undefined} key={option}>
                    <input
                      checked={theme === option}
                      name="house-theme"
                      onChange={() => setTheme(option)}
                      type="radio"
                      value={option}
                    />
                    {option === 'system' ? t('themeSystem') : option === 'light' ? t('themeLight') : t('themeDark')}
                  </label>
                ))}
              </fieldset>
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
              <p className="house-panel__hint">{t('shortcutHint')}</p>
            </div>
          )}
        </div>
      )}

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
            <div className="house-card__actions">
              <button
                className="house-button"
                disabled={props.signIn === undefined}
                onClick={props.signIn}
                type="button"
              >
                {t('signInAction')}
              </button>
            </div>
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
        ) : stage.kind === 'component' ? (
          <ComponentStage
            locale={locale}
            home={home}
            onRetry={props.onRetry}
            onSwitchAway={openHomes}
            screen={props.componentScreen}
            t={t}
          />
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
            call={props.call}
            focusShell={focusShell}
            home={home}
            homeState={props.homeState}
            key={restartKey}
            locale={locale}
            mount={props.mountHouseApp ?? mountHouseApp}
            onRetry={() => setRestartKey((key) => key + 1)}
            onSwitchAway={openHomes}
            release={stage.release}
            sandboxOrigin={props.sandboxOrigin}
            t={t}
            theme={theme}
          />
        )}
      </main>
    </div>
  );
}
