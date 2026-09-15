import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { App, type AppProps } from './app';
import { createDemoHost } from './demo-host';
import type { TrustedHost } from './host';
import { HomeIcon, LockIcon, SparkIcon } from './icons';

export const AGENT_START_PROMPT = 'Installe la CLI `miakapp` via `npm i -g @miakapp/cli` puis fais `miakapp docs start` pour commencer.';

type ProductRoute = 'landing' | 'login' | 'new-home' | 'console';
type CopyState = 'idle' | 'copied' | 'failed';

export interface ProductAppProps extends Omit<AppProps, 'host'> {
  readonly createHost?: () => TrustedHost;
  readonly initialRoute?: ProductRoute;
  readonly writeClipboard?: (text: string) => Promise<void>;
}

function routeFromPath(pathname: string): ProductRoute {
  if (pathname === '/login') return 'login';
  if (pathname === '/new-home') return 'new-home';
  if (pathname === '/app') return 'console';
  return 'landing';
}

function pathFor(route: ProductRoute): string {
  if (route === 'login') return '/login';
  if (route === 'new-home') return '/new-home';
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

function ProductChrome({
  children,
  onNavigate,
}: {
  readonly children: React.ReactNode;
  readonly onNavigate: (route: ProductRoute) => void;
}): React.JSX.Element {
  return (
    <div className="product-shell">
      <header className="product-header">
        <ProductBrand onNavigate={() => onNavigate('landing')} />
        <nav aria-label="Navigation produit">
          <button onClick={() => onNavigate('login')} type="button">Se connecter</button>
          <button className="product-button product-button--compact" onClick={() => onNavigate('new-home')} type="button">
            Créer ma maison
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

function LandingPage({ onNavigate }: { readonly onNavigate: (route: ProductRoute) => void }): React.JSX.Element {
  return (
    <ProductChrome onNavigate={onNavigate}>
      <main className="landing-page">
        <section className="landing-hero">
          <div className="landing-hero__copy">
            <p className="product-kicker"><span /> Votre maison, écrite pour vous</p>
            <h1>L’interface de votre maison ne devrait ressembler qu’à vous.</h1>
            <p className="landing-hero__lede">
              Miakapp donne à votre agent de code les outils pour construire vos pages,
              connecter vos appareils et faire évoluer votre maison — sans enfermer votre interface.
            </p>
            <div className="product-actions">
              <button className="product-button" onClick={() => onNavigate('new-home')} type="button">
                Créer ma maison <span aria-hidden="true">→</span>
              </button>
              <button className="product-button product-button--ghost" onClick={() => onNavigate('console')} type="button">
                Voir la maison de démonstration
              </button>
            </div>
            <ul className="landing-proof" aria-label="Principes Miakapp">
              <li><span>01</span> Votre dépôt Git</li>
              <li><span>02</span> Votre agent</li>
              <li><span>03</span> Votre interface</li>
            </ul>
          </div>
          <div className="landing-visual" aria-label="Aperçu d’une maison Miakapp">
            <div className="landing-visual__orb landing-visual__orb--one" />
            <div className="landing-visual__orb landing-visual__orb--two" />
            <article className="landing-home-card">
              <header>
                <span className="landing-home-card__icon"><HomeIcon /></span>
                <div><strong>Maison Horizon</strong><small>Tout est calme</small></div>
                <span className="landing-home-card__live">En direct</span>
              </header>
              <div className="landing-home-card__metric"><strong>19,5°</strong><span>Salon</span></div>
              <div className="landing-home-card__row">
                <span><small>Énergie</small><strong>350 W</strong></span>
                <span><small>Batterie</small><strong>80 %</strong></span>
              </div>
              <div className="landing-home-card__control">
                <span>Éclairage du salon</span><span className="landing-toggle" />
              </div>
            </article>
            <p className="landing-agent-note"><SparkIcon /><span><strong>Construit par votre agent</strong><small>Modifiable à tout moment</small></span></p>
          </div>
        </section>
        <section className="landing-principles">
          <p className="product-kicker">Pas une app domotique de plus</p>
          <h2>Miakapp sépare ce qui doit rester stable de ce qui doit rester libre.</h2>
          <div>
            <article><strong>Le socle protège</strong><p>Identité, permissions, connexion et exécution restent dans un hôte de confiance.</p></article>
            <article><strong>L’agent construit</strong><p>Pages, navigation, composants et style vivent dans votre dépôt et évoluent avec vous.</p></article>
            <article><strong>La maison répond</strong><p>Les coordinateurs exposent les états et actions. Ils ne décident jamais de l’interface.</p></article>
          </div>
        </section>
      </main>
    </ProductChrome>
  );
}

function LoginPage({ host, onNavigate }: { readonly host: TrustedHost; readonly onNavigate: (route: ProductRoute) => void }): React.JSX.Element {
  return (
    <ProductChrome onNavigate={onNavigate}>
      <main className="product-centered">
        <section className="auth-card">
          <span className="auth-card__icon"><LockIcon /></span>
          <p className="product-kicker">Espace personnel</p>
          <h1>Retrouvez votre maison.</h1>
          <p>Connectez-vous pour ouvrir une installation existante ou commencer une nouvelle maison.</p>
          <button className="google-button" disabled={host.signIn === undefined} onClick={host.signIn} type="button">
            <span aria-hidden="true">G</span> Continuer avec Google
          </button>
          <small>Miakapp utilise votre identité pour ouvrir uniquement les maisons auxquelles vous avez accès.</small>
          <button className="text-button" onClick={() => onNavigate('landing')} type="button">← Retour à l’accueil</button>
        </section>
      </main>
    </ProductChrome>
  );
}

function NewHomePage({
  copyState,
  onCopy,
  onNavigate,
}: {
  readonly copyState: CopyState;
  readonly onCopy: () => void;
  readonly onNavigate: (route: ProductRoute) => void;
}): React.JSX.Element {
  return (
    <ProductChrome onNavigate={onNavigate}>
      <main className="onboarding-page">
        <header className="onboarding-heading">
          <p className="product-kicker"><span /> Nouvelle maison</p>
          <h1>Donnez ce point de départ à votre agent.</h1>
          <p>Il installera le guide Miakapp, découvrira votre installation et construira votre interface dans votre propre dépôt.</p>
        </header>
        <section className="onboarding-grid">
          <article className="onboarding-step onboarding-step--prompt">
            <span className="onboarding-step__number">01</span>
            <div>
              <p className="product-kicker">Claude Code ou Codex</p>
              <h2>Copiez ce prompt</h2>
              <pre><code>{AGENT_START_PROMPT}</code></pre>
              <button className="product-button" onClick={onCopy} type="button">
                {copyState === 'copied' ? 'Prompt copié' : 'Copier le prompt'}
              </button>
              {copyState === 'failed' ? (
                <p role="alert">Copie impossible. Sélectionnez le prompt ci-dessus.</p>
              ) : null}
            </div>
          </article>
          <article className="onboarding-step onboarding-step--molted">
            <span className="onboarding-step__number">02</span>
            <div>
              <span className="recommended-pill">Recommandé</span>
              <h2>Ou laissez Molted préparer l’agent</h2>
              <p>Un espace prêt à l’emploi, sans terminal ni infrastructure à maintenir.</p>
              <a className="product-button product-button--dark" href="https://molted.cloud" rel="noreferrer" target="_blank">
                Utiliser dans molted.cloud <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        </section>
        <button className="text-button" onClick={() => onNavigate('console')} type="button">J’ai déjà une maison →</button>
      </main>
    </ProductChrome>
  );
}

export function ProductApp({
  createHost = createDemoHost,
  initialRoute,
  writeClipboard = async (text) => navigator.clipboard.writeText(text),
  ...appProps
}: ProductAppProps): React.JSX.Element {
  const [host] = useState<TrustedHost>(() => createHost());
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const requestedRoute = initialRoute ?? routeFromPath(window.location.pathname);
  const [route, setRoute] = useState<ProductRoute>(() => {
    return requestedRoute === 'new-home' && !snapshot.authenticated && !snapshot.preview
      ? 'login'
      : requestedRoute;
  });
  const [pendingAfterLogin, setPendingAfterLogin] = useState<ProductRoute>(() => (
    requestedRoute === 'new-home' ? 'new-home' : 'console'
  ));
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const navigate = useCallback((next: ProductRoute): void => {
    const target = next === 'new-home' && !snapshot.authenticated && !snapshot.preview ? 'login' : next;
    if (target === 'login' && next === 'new-home') setPendingAfterLogin('new-home');
    if (target === 'login' && next === 'login') setPendingAfterLogin('console');
    window.history.pushState({}, '', pathFor(target));
    setRoute(target);
  }, [snapshot.authenticated, snapshot.preview]);

  const displayedRoute = route === 'login' && snapshot.authenticated
    ? pendingAfterLogin
    : route;

  useEffect(() => {
    const onPopState = (): void => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (route !== 'login' || !snapshot.authenticated) return;
    window.history.replaceState({}, '', pathFor(pendingAfterLogin));
  }, [pendingAfterLogin, route, snapshot.authenticated]);

  useEffect(() => () => host.dispose(), [host]);

  if (displayedRoute === 'console') return <App {...appProps} host={host} />;
  if (displayedRoute === 'login') return <LoginPage host={host} onNavigate={navigate} />;
  if (displayedRoute === 'new-home') {
    return (
      <NewHomePage
        copyState={copyState}
        onCopy={() => {
          setCopyState('idle');
          void writeClipboard(AGENT_START_PROMPT).then(
            () => setCopyState('copied'),
            () => setCopyState('failed'),
          );
        }}
        onNavigate={navigate}
      />
    );
  }
  return <LandingPage onNavigate={navigate} />;
}
