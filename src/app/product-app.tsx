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
import { createDemoHost } from './demo-host';
import type { TrustedHost } from './host';
import { HomeIcon, LockIcon, SparkIcon } from './icons';
import { PairPage } from './pair-page';
import type { PairingService } from './pairing-client';

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
      <span className="product-brand__mark"><SparkIcon /></span>
      <span>miakapp</span>
      <small>v4</small>
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

function LandingPage({ t, ...chrome }: PageProps): React.JSX.Element {
  const { onNavigate } = chrome;
  return (
    <ProductChrome t={t} {...chrome}>
      <main className="landing-page">
        <section className="landing-hero">
          <div className="landing-hero__copy">
            <p className="product-kicker"><span /> {t('landingKicker')}</p>
            <h1>{t('landingTitle')}</h1>
            <p className="landing-hero__lede">{t('landingLede')}</p>
            <div className="product-actions">
              <button className="product-button" onClick={() => onNavigate('new-home')} type="button">
                {t('landingPrimaryCta')} <span aria-hidden="true">→</span>
              </button>
              <button className="product-button product-button--ghost" onClick={() => onNavigate('console')} type="button">
                {t('landingSecondaryCta')}
              </button>
            </div>
            <ul className="landing-proof" aria-label={t('landingProofLabel')}>
              <li><span>01</span> {t('landingProofOne')}</li>
              <li><span>02</span> {t('landingProofTwo')}</li>
              <li><span>03</span> {t('landingProofThree')}</li>
            </ul>
          </div>
          <div className="landing-visual" aria-label={t('landingCardVisualLabel')}>
            <div className="landing-visual__orb landing-visual__orb--one" />
            <div className="landing-visual__orb landing-visual__orb--two" />
            <article className="landing-home-card">
              <header>
                <span className="landing-home-card__icon"><HomeIcon /></span>
                <div><strong>{t('landingCardHome')}</strong><small>{t('landingCardCalm')}</small></div>
                <span className="landing-home-card__live">{t('landingCardLive')}</span>
              </header>
              <div className="landing-home-card__metric"><strong>19,5°</strong><span>{t('landingCardRoom')}</span></div>
              <div className="landing-home-card__row">
                <span><small>{t('landingCardEnergy')}</small><strong>350 W</strong></span>
                <span><small>{t('landingCardBattery')}</small><strong>80 %</strong></span>
              </div>
              <div className="landing-home-card__control">
                <span>{t('landingCardLight')}</span><span className="landing-toggle" />
              </div>
            </article>
            <p className="landing-agent-note">
              <SparkIcon />
              <span><strong>{t('landingAgentNote')}</strong><small>{t('landingAgentNoteDetail')}</small></span>
            </p>
          </div>
        </section>
        <section className="landing-audiences">
          <p className="product-kicker">{t('audiencesKicker')}</p>
          <h2>{t('audiencesTitle')}</h2>
          <div>
            <article>
              <strong>{t('audienceTinkererTitle')}</strong>
              <p>{t('audienceTinkererBody')}</p>
            </article>
            <article>
              <strong>{t('audienceCuriousTitle')}</strong>
              <p>{t('audienceCuriousBody')}</p>
            </article>
            <article>
              <strong>{t('audienceNewcomerTitle')}</strong>
              <p>{t('audienceNewcomerBody')}</p>
            </article>
          </div>
        </section>
        <section className="landing-principles">
          <p className="product-kicker">{t('principlesKicker')}</p>
          <h2>{t('principlesTitle')}</h2>
          <div>
            <article><strong>{t('principleBaseTitle')}</strong><p>{t('principleBaseBody')}</p></article>
            <article><strong>{t('principleAgentTitle')}</strong><p>{t('principleAgentBody')}</p></article>
            <article><strong>{t('principleHomeTitle')}</strong><p>{t('principleHomeBody')}</p></article>
          </div>
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
          <button className="google-button" disabled={host.signIn === undefined} onClick={host.signIn} type="button">
            <span aria-hidden="true">G</span> {t('loginGoogle')}
          </button>
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
              <a className="product-button product-button--dark" href="https://molted.cloud" rel="noreferrer" target="_blank">
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
  createHost = createDemoHost,
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
