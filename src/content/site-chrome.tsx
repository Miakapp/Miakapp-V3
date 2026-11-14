// Header and footer of the static content pages. They are plain links rather
// than the app's buttons: the pages ship no script, and a crawler follows links.
import { COPY, LOCALES, LOCALE_LABELS, type Locale } from '../app/copy';
import { APP_LINKS, contentPage, publishedPages, SOURCE_URL, type ContentPageId } from './site';

const CHROME = {
  en: {
    guides: 'Guides',
    tagline: 'The smart home that builds itself.',
    explore: 'Learn',
    product: 'Miakapp',
    source: 'Source code',
  },
  fr: {
    guides: 'Guides',
    tagline: 'La maison connectée qui se construit toute seule.',
    explore: 'Comprendre',
    product: 'Miakapp',
    source: 'Code source',
  },
} as const satisfies Record<Locale, Record<string, string>>;

/** Every page of the site has a counterpart in each language; the switch
 *  links to the same page in the other language rather than to the landing. */
type Alternates = Readonly<Record<Locale, string>>;

export function SiteHeader({ alternates, locale }: { readonly alternates: Alternates; readonly locale: Locale }): React.JSX.Element {
  const t = COPY[locale];
  return (
    <header className="product-header">
      <a className="product-brand" href={APP_LINKS.landing[locale]}>
        <img alt="" className="brand-mark product-brand__mark" src="/brand/miakapp.svg" />
        <span>miakapp</span>
      </a>
      <nav aria-label="Miakapp">
        <a className="product-header__link" href={contentPage('guides').path[locale]}>{CHROME[locale].guides}</a>
        <div className="locale-switch" role="group" aria-label={t.localeSwitchLabel}>
          {LOCALES.map((candidate) => (
            <a
              aria-current={candidate === locale ? 'page' : undefined}
              className={candidate === locale ? 'locale-switch__option is-active' : 'locale-switch__option'}
              href={alternates[candidate]}
              hrefLang={candidate}
              key={candidate}
              lang={candidate}
            >
              <span aria-hidden="true">{candidate.toUpperCase()}</span>
              <span className="visually-hidden">{LOCALE_LABELS[candidate]}</span>
            </a>
          ))}
        </div>
        <a className="product-header__link" href={APP_LINKS.signIn}>{t.navSignIn}</a>
        <a className="product-button product-button--compact" href={APP_LINKS.newHome}>{t.navCreate}</a>
      </nav>
    </header>
  );
}

export function SiteFooter({ locale }: { readonly locale: Locale }): React.JSX.Element {
  const t = COPY[locale];
  const words = CHROME[locale];
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <img alt="" className="brand-mark" src="/brand/miakapp.svg" />
        <p><strong>miakapp</strong><br />{words.tagline}</p>
      </div>
      <nav aria-label={words.explore}>
        <strong>{words.explore}</strong>
        {publishedPages().filter((page) => page.kind === 'page').map((page) => (
          <a href={page.path[locale]} key={page.id}>{page.title[locale]}</a>
        ))}
      </nav>
      <nav aria-label={words.product}>
        <strong>{words.product}</strong>
        <a href={APP_LINKS.newHome}>{t.navCreate}</a>
        <a href={APP_LINKS.signIn}>{t.navSignIn}</a>
        <a href={SOURCE_URL} rel="noopener">{words.source}</a>
      </nav>
    </footer>
  );
}

export interface ContentPageProps {
  readonly locale: Locale;
}

/** The frame every content page shares: the Lumière light, the header, the
 *  footer. `id` names the page so the language switch can find its twin. */
export function ContentShell({
  children,
  id,
  locale,
}: {
  readonly children: React.ReactNode;
  readonly id: ContentPageId;
  readonly locale: Locale;
}): React.JSX.Element {
  return (
    <div className="product-shell">
      <div className="product-shell__light" aria-hidden="true" />
      <SiteHeader alternates={contentPage(id).path} locale={locale} />
      <main className="content-page">{children}</main>
      <SiteFooter locale={locale} />
    </div>
  );
}

/** A request said to the agent, set apart so it reads as speech. */
export function Ask({ children, locale }: { readonly children: React.ReactNode; readonly locale: Locale }): React.JSX.Element {
  return <p className="content-ask">{locale === 'fr' ? <>«&nbsp;{children}&nbsp;»</> : <>“{children}”</>}</p>;
}
