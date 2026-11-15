import type { Locale } from '../app/copy';
import { CONTENT_PAGES, publishedPages, type ContentPageMeta } from './site';
import { ContentShell, type ContentPageProps } from './site-chrome';

interface HubCopy {
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly read: string;
  readonly nextTitle: string;
  readonly nextLede: string;
  readonly guidesTitle: string;
  readonly compareTitle: string;
  readonly soon: string;
}

const COPY: Record<Locale, HubCopy> = {
  fr: {
    kicker: 'Guides',
    title: 'Comprendre Miakapp, et libérer vos appareils.',
    lede: 'Miakapp est un socle : un agent de code y construit votre maison connectée, son interface et ses automatisations. Ces pages expliquent ce que fait le socle, ce que vous pouvez demander à l’agent, et comment se passer des boîtiers propriétaires hors de prix.',
    read: 'Lire',
    guidesTitle: 'Guides par appareil',
    compareTitle: 'Comparatifs',
    nextTitle: 'Bientôt',
    nextLede: 'D’autres guides par appareil et des comparatifs honnêtes, toujours sourcés. Puis des histoires vraies de maisons construites avec Miakapp.',
    soon: 'Bientôt',
  },
  en: {
    kicker: 'Guides',
    title: 'Understand Miakapp, and free your devices.',
    lede: 'Miakapp is a foundation: a coding agent builds your smart home on it, its interface and its automations. These pages explain what the foundation does, what you can ask the agent, and how to do without overpriced proprietary hubs.',
    read: 'Read',
    guidesTitle: 'Device guides',
    compareTitle: 'Comparisons',
    nextTitle: 'Coming soon',
    nextLede: 'More device guides and honest comparisons, always sourced. Then true stories of homes built with Miakapp.',
    soon: 'Soon',
  },
};

function LinkCard({ page, locale, read }: { readonly page: ContentPageMeta; readonly locale: Locale; readonly read: string }): React.JSX.Element {
  return (
    <a className="glass content-card-link" href={page.path[locale]}>
      <h2>{page.title[locale]}</h2>
      <p>{page.description[locale]}</p>
      <span>{read} <span aria-hidden="true">→</span></span>
    </a>
  );
}

export function GuidesHubPage({ locale }: ContentPageProps): React.JSX.Element {
  const copy = COPY[locale];
  const published = publishedPages();
  const guides = published.filter((page) => page.kind === 'guide');
  const comparisons = published.filter((page) => page.kind === 'compare');
  const upcoming = CONTENT_PAGES.filter((page) => page.kind !== 'page' && !published.includes(page));
  return (
    <ContentShell id="guides" locale={locale}>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> {copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="content-lede">{copy.lede}</p>
      </header>

      <section className="content-section">
        <div className="content-cards content-cards--links">
          {published.filter((page) => page.kind === 'page' && page.id !== 'guides').map((page) => (
            <LinkCard key={page.id} locale={locale} page={page} read={copy.read} />
          ))}
        </div>
      </section>

      {guides.length > 0 ? (
        <section className="content-section">
          <h2>{copy.guidesTitle}</h2>
          <div className="content-cards content-cards--links">
            {guides.map((page) => <LinkCard key={page.id} locale={locale} page={page} read={copy.read} />)}
          </div>
        </section>
      ) : null}

      {comparisons.length > 0 ? (
        <section className="content-section">
          <h2>{copy.compareTitle}</h2>
          <div className="content-cards content-cards--links">
            {comparisons.map((page) => <LinkCard key={page.id} locale={locale} page={page} read={copy.read} />)}
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <h2>{copy.nextTitle}</h2>
        <p>{copy.nextLede}</p>
        {upcoming.length > 0 ? (
          <div className="landing-grid">
            {upcoming.map((page) => (
              <article className="glass" key={page.id}>
                <span className="content-badge">{copy.soon}</span>
                <strong>{page.title[locale]}</strong>
                <p>{page.description[locale]}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </ContentShell>
  );
}
