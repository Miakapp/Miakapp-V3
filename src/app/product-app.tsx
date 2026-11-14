import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { App, type AppProps } from './app';
import {
  agentStartPrompt,
  COPY,
  LOCALES,
  LOCALE_LABELS,
  readStoredLocale,
  resolveLocale,
  writeStoredLocale,
  type CopyKey,
  type Locale,
} from './copy';
import { createPreviewHost } from './preview-host';
import type { TrustedHost } from './host';
import { ActivityIcon, HomeIcon, LockIcon, SparkIcon } from './icons';
import './product.css';
import { PairPage } from './pair-page';
import type { PairingService } from './pairing-client';
import { SignInChoices } from './sign-in-choices';

type ProductRoute = 'landing' | 'login' | 'new-home' | 'pair' | 'console';
type CopyState = 'idle' | 'copied' | 'failed';

export interface ProductAppProps extends Omit<AppProps, 'host'> {
  readonly createHost?: () => TrustedHost;
  readonly initialRoute?: ProductRoute;
  readonly writeClipboard?: (text: string) => Promise<void>;
  readonly initialLocale?: Locale;
  /** Undefined in a preview build: `/pair` then explains that it cannot pair. */
  readonly createPairingService?: () => PairingService | undefined;
}

/** Reads one string in the active language. Passed down rather than pulled from
 *  a context, so every component that shows text says so in its signature. */
export type Translate = (key: CopyKey) => string;

function routeFromPath(pathname: string): ProductRoute {
  if (pathname === '/login') return 'login';
  if (pathname === '/new-home') return 'new-home';
  if (pathname === '/pair') return 'pair';
  if (pathname === '/app') return 'console';
  return 'landing';
}

function pathFor(route: ProductRoute): string {
  if (route === 'login') return '/login';
  if (route === 'new-home') return '/new-home';
  if (route === 'pair') return '/pair';
  if (route === 'console') return '/app';
  return '/';
}

function ProductBrand({ onNavigate }: { readonly onNavigate: () => void }): React.JSX.Element {
  return (
    <button className="product-brand" onClick={onNavigate} type="button">
      <img alt="" className="brand-mark product-brand__mark" src="/brand/miakapp.svg" />
      <span>miakapp</span>
    </button>
  );
}

function LocaleSwitch({
  locale,
  onChange,
  t,
}: {
  readonly locale: Locale;
  readonly onChange: (locale: Locale) => void;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div className="locale-switch" role="group" aria-label={t('localeSwitchLabel')}>
      {LOCALES.map((candidate) => (
        <button
          aria-pressed={candidate === locale}
          className={candidate === locale ? 'locale-switch__option is-active' : 'locale-switch__option'}
          key={candidate}
          lang={candidate}
          onClick={() => onChange(candidate)}
          type="button"
        >
          <span aria-hidden="true">{candidate.toUpperCase()}</span>
          <span className="visually-hidden">{LOCALE_LABELS[candidate]}</span>
        </button>
      ))}
    </div>
  );
}

interface ChromeProps {
  readonly children: React.ReactNode;
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly onNavigate: (route: ProductRoute) => void;
  readonly t: Translate;
}

function ProductChrome({
  children,
  locale,
  onLocaleChange,
  onNavigate,
  t,
}: ChromeProps): React.JSX.Element {
  return (
    <div className="product-shell">
      <div className="product-shell__light" aria-hidden="true" />
      <header className="product-header">
        <ProductBrand onNavigate={() => onNavigate('landing')} />
        <nav aria-label="Miakapp">
          <LocaleSwitch locale={locale} onChange={onLocaleChange} t={t} />
          <button onClick={() => onNavigate('login')} type="button">{t('navSignIn')}</button>
          <button className="product-button product-button--compact" onClick={() => onNavigate('new-home')} type="button">
            {t('navCreate')}
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

type PageProps = Omit<ChromeProps, 'children'>;

function LandingTitle({ t }: { readonly t: Translate }): React.JSX.Element {
  const title = t('landingTitle');
  const accent = t('landingTitleAccent');
  const at = title.indexOf(accent);
  if (at < 0) return <h1>{title}</h1>;
  return (
    <h1>
      {title.slice(0, at)}<em>{accent}</em>{title.slice(at + accent.length)}
    </h1>
  );
}

const ENERGY_BARS = [30, 45, 38, 70, 92, 60, 48, 34];

function LandingVisual({ t }: { readonly t: Translate }): React.JSX.Element {
  return (
    <div className="landing-visual" role="img" aria-label={t('landingCardVisualLabel')}>
      <div className="glass landing-widget landing-widget--climate">
        <small>{t('landingCardRoom')}</small>
        <strong>21,5°</strong>
        <span>{t('landingCardHeating')}</span>
      </div>
      <div className="glass landing-widget landing-widget--light">
        <div><small>{t('landingCardLight')}</small><span className="landing-toggle" /></div>
        <strong>{t('landingCardScene')}</strong>
        <span>{t('landingCardLamps')}</span>
      </div>
      <div className="glass landing-widget landing-widget--energy">
        <small>{t('landingCardEnergy')}</small>
        <div className="landing-bars">
          {ENERGY_BARS.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
        </div>
      </div>
      <div className="glass landing-widget landing-widget--agent">
        <img alt="" className="brand-mark" src="/brand/miakapp.svg" />
        <p>
          <strong>{t('landingAgentNote')}</strong> {t('landingAgentNoteDetail')}
          <small>{t('landingAgentNoteMeta')}</small>
        </p>
      </div>
      <div className="glass landing-widget landing-widget--screen">
        <small>{t('landingCardNewScreen')}</small>
        <div>
          <span>{t('landingCardChipKitchen')}</span>
          <span>{t('landingCardChipShutters')}</span>
          <span>{t('landingCardChipGarden')}</span>
          <span>{t('landingCardChipAdd')}</span>
        </div>
      </div>
    </div>
  );
}

function LandingPage({ t, ...chrome }: PageProps): React.JSX.Element {
  const { onNavigate } = chrome;
  return (
    <ProductChrome t={t} {...chrome}>
      <main className="landing-page">
        <section className="landing-hero">
          <div className="landing-hero__copy">
            <p className="product-kicker glass"><span /> {t('landingKicker')}</p>
            <LandingTitle t={t} />
            <p className="landing-hero__lede">{t('landingLede')}</p>
            <div className="product-actions">
              <button className="product-button" onClick={() => onNavigate('new-home')} type="button">
                {t('landingPrimaryCta')} <span aria-hidden="true">→</span>
              </button>
              <button className="product-button product-button--glass" onClick={() => onNavigate('login')} type="button">
                {t('landingSecondaryCta')}
              </button>
            </div>
            <ul className="landing-proof" aria-label={t('landingProofLabel')}>
              <li className="glass">{t('landingProofOne')}</li>
              <li className="glass">{t('landingProofTwo')}</li>
              <li className="glass">{t('landingProofThree')}</li>
            </ul>
          </div>
          <LandingVisual t={t} />
        </section>
        <section className="landing-section">
          <p className="product-kicker glass"><span /> {t('socleKicker')}</p>
          <h2>{t('socleTitle')}</h2>
          <div className="landing-grid landing-grid--four">
            <article className="glass">
              <span className="landing-tile-icon landing-tile-icon--peach"><ActivityIcon /></span>
              <strong>{t('socleHostingTitle')}</strong>
              <p>{t('socleHostingBody')}</p>
            </article>
            <article className="glass">
              <span className="landing-tile-icon landing-tile-icon--mint"><LockIcon /></span>
              <strong>{t('socleAuthTitle')}</strong>
              <p>{t('socleAuthBody')}</p>
            </article>
            <article className="glass">
              <span className="landing-tile-icon landing-tile-icon--lilac"><SparkIcon /></span>
              <strong>{t('soclePushTitle')}</strong>
              <p>{t('soclePushBody')}</p>
            </article>
            <article className="glass">
              <span className="landing-tile-icon landing-tile-icon--honey"><HomeIcon /></span>
              <strong>{t('socleLocalTitle')}</strong>
              <p>{t('socleLocalBody')}</p>
            </article>
          </div>
        </section>
        <section className="landing-section">
          <p className="product-kicker glass"><span /> {t('audiencesKicker')}</p>
          <h2>{t('audiencesTitle')}</h2>
          <div className="landing-grid">
            <article className="glass">
              <strong>{t('audienceTinkererTitle')}</strong>
              <p>{t('audienceTinkererBody')}</p>
            </article>
            <article className="glass">
              <strong>{t('audienceCuriousTitle')}</strong>
              <p>{t('audienceCuriousBody')}</p>
            </article>
            <article className="glass">
              <strong>{t('audienceNewcomerTitle')}</strong>
              <p>{t('audienceNewcomerBody')}</p>
            </article>
          </div>
        </section>
        <section className="landing-closing">
          <div>
            <h2>{t('closingTitle')}</h2>
            <p>{t('closingBody')}</p>
          </div>
          <button className="product-button product-button--light" onClick={() => onNavigate('new-home')} type="button">
            {t('closingCta')} <span aria-hidden="true">→</span>
          </button>
        </section>
      </main>
    </ProductChrome>
  );
}

function LoginPage({ host, t, ...chrome }: PageProps & { readonly host: TrustedHost }): React.JSX.Element {
  const { onNavigate } = chrome;
  return (
    <ProductChrome t={t} {...chrome}>
      <main className="product-centered">
        <section className="auth-card">
          <span className="auth-card__icon"><LockIcon /></span>
          <p className="product-kicker">{t('loginKicker')}</p>
          <h1>{t('loginTitle')}</h1>
          <p>{t('loginLede')}</p>
          {host.signInWith !== undefined ? (
            <SignInChoices locale={chrome.locale} signIn={host.signInWith} />
          ) : (
            <button className="google-button" disabled={host.signIn === undefined} onClick={host.signIn} type="button">
              <span aria-hidden="true">G</span> {t('loginGoogle')}
            </button>
          )}
          <small>{t('loginPrivacy')}</small>
          <button className="text-button" onClick={() => onNavigate('landing')} type="button">{t('loginBack')}</button>
        </section>
      </main>
    </ProductChrome>
  );
}

function NewHomePage({
  copyState,
  onCopy,
  t,
  ...chrome
}: PageProps & {
  readonly copyState: CopyState;
  readonly onCopy: () => void;
}): React.JSX.Element {
  const { onNavigate } = chrome;
  return (
    <ProductChrome t={t} {...chrome}>
      <main className="onboarding-page">
        <header className="onboarding-heading">
          <p className="product-kicker"><span /> {t('onboardingKicker')}</p>
          <h1>{t('onboardingTitle')}</h1>
          <p>{t('onboardingLede')}</p>
        </header>
        <section className="onboarding-grid">
          <article className="onboarding-step onboarding-step--prompt">
            <span className="onboarding-step__number">01</span>
            <div>
              <p className="product-kicker">{t('onboardingPromptKicker')}</p>
              <h2>{t('onboardingPromptTitle')}</h2>
              {/* The sentence follows the page's language; the commands inside
                  it never do, because an agent runs them verbatim. */}
              <pre><code>{t('onboardingAgentPrompt')}</code></pre>
              <button className="product-button" onClick={onCopy} type="button">
                {copyState === 'copied' ? t('onboardingCopied') : t('onboardingCopy')}
              </button>
              {copyState === 'failed' ? <p role="alert">{t('onboardingCopyFailed')}</p> : null}
            </div>
          </article>
          <article className="onboarding-step onboarding-step--molted">
            <span className="onboarding-step__number">02</span>
            <div>
              <span className="recommended-pill">{t('onboardingRecommended')}</span>
              <h2>{t('onboardingMoltedTitle')}</h2>
              <p>{t('onboardingMoltedBody')}</p>
              <a className="product-button product-button--dark" href={t('onboardingMoltedUrl')} rel="noreferrer" target="_blank">
                {t('onboardingMoltedCta')} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        </section>
        <aside className="onboarding-next">
          <span className="onboarding-next__icon"><LockIcon /></span>
          <div>
            <strong>{t('onboardingAccountTitle')}</strong>
            <p>{t('onboardingAccountBody')}</p>
          </div>
        </aside>
        <button className="text-button" onClick={() => onNavigate('console')} type="button">
          {t('onboardingHasHome')}
        </button>
      </main>
    </ProductChrome>
  );
}

export function ProductApp({
  createHost = createPreviewHost,
  initialRoute,
  initialLocale,
  writeClipboard = async (text) => navigator.clipboard.writeText(text),
  createPairingService,
  ...appProps
}: ProductAppProps): React.JSX.Element {
  const [host] = useState<TrustedHost>(() => createHost());
  const [pairing] = useState<PairingService | undefined>(() => createPairingService?.());
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const [route, setRoute] = useState<ProductRoute>(
    () => initialRoute ?? routeFromPath(window.location.pathname),
  );
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [locale, setLocale] = useState<Locale>(() => (
    initialLocale
    ?? resolveLocale(readStoredLocale(globalThis.localStorage), navigator.languages ?? [navigator.language])
  ));

  const t = useCallback<Translate>((key) => COPY[locale][key], [locale]);

  const changeLocale = useCallback((next: Locale): void => {
    setLocale(next);
    writeStoredLocale(globalThis.localStorage, next);
  }, []);

  // The document's own language is part of the page, not decoration: it is what
  // a screen reader picks a voice from and what a translation prompt keys off.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const navigate = useCallback((next: ProductRoute): void => {
    window.history.pushState({}, '', pathFor(next));
    setRoute(next);
  }, []);

  // Signing in is never a toll on the way somewhere else, so there is nowhere
  // to resume: whoever reaches `/login` asked for it, and what they asked for
  // is their existing home.
  const displayedRoute = route === 'login' && snapshot.authenticated ? 'console' : route;

  useEffect(() => {
    const onPopState = (): void => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (route !== 'login' || !snapshot.authenticated) return;
    window.history.replaceState({}, '', pathFor('console'));
  }, [route, snapshot.authenticated]);

  useEffect(() => () => host.dispose(), [host]);
  useEffect(() => () => pairing?.dispose(), [pairing]);

  const chrome = { locale, onLocaleChange: changeLocale, onNavigate: navigate, t };

  if (displayedRoute === 'console') return <App {...appProps} host={host} />;
  if (displayedRoute === 'login') return <LoginPage host={host} {...chrome} />;
  if (displayedRoute === 'pair') {
    return (
      <ProductChrome {...chrome}>
        <PairPage locale={locale} service={pairing} t={t} writeClipboard={writeClipboard} />
      </ProductChrome>
    );
  }
  if (displayedRoute === 'new-home') {
    return (
      <NewHomePage
        copyState={copyState}
        onCopy={() => {
          setCopyState('idle');
          void writeClipboard(agentStartPrompt(locale)).then(
            () => setCopyState('copied'),
            () => setCopyState('failed'),
          );
        }}
        {...chrome}
      />
    );
  }
  return <LandingPage {...chrome} />;
}
