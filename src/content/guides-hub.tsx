import type { Locale } from '../app/copy';
import { CONTENT_PAGES, type ContentPageId } from './site';
import { ContentShell, type ContentPageProps } from './site-chrome';

interface HubCopy {
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly read: string;
  readonly nextTitle: string;
  readonly nextLede: string;
  readonly next: readonly { readonly title: string; readonly body: string }[];
  readonly soon: string;
}

const COPY: Record<Locale, HubCopy> = {
  fr: {
    kicker: 'Guides',
    title: 'Comprendre Miakapp, et libérer vos appareils.',
    lede: 'Miakapp est un socle : un agent de code y construit votre maison connectée, son interface et ses automatisations. Ces pages expliquent ce que fait le socle, ce que vous pouvez demander à l’agent, et comment se passer des boîtiers propriétaires hors de prix.',
    read: 'Lire',
    nextTitle: 'Bientôt',
    nextLede: 'Des guides par appareil, partant d’un problème que beaucoup connaissent, avec le matériel ouvert nécessaire, un ordre de prix et des sources vérifiées. Puis des comparatifs honnêtes avec les autres plateformes.',
    next: [
      { title: 'Velux sans le boîtier officiel', body: 'Fenêtres de toit et volets io-homecontrol, sans passer par la box du fabricant.' },
      { title: 'Une clim sans le module Wi-Fi', body: 'Piloter une climatisation qui n’a qu’une télécommande, sans l’option Wi-Fi vendue à part.' },
      { title: 'Volets Somfy RTS', body: 'Commander des volets radio sans racheter de box.' },
    ],
    soon: 'Bientôt',
  },
  en: {
    kicker: 'Guides',
    title: 'Understand Miakapp, and free your devices.',
    lede: 'Miakapp is a foundation: a coding agent builds your smart home on it, its interface and its automations. These pages explain what the foundation does, what you can ask the agent, and how to do without overpriced proprietary hubs.',
    read: 'Read',
    nextTitle: 'Coming soon',
    nextLede: 'Device guides that start from a problem many people know, with the open hardware it takes, a price range and checked sources. Then honest comparisons with other platforms.',
    next: [
      { title: 'Velux without the official hub', body: 'io-homecontrol roof windows and blinds, without the manufacturer’s box.' },
      { title: 'Air conditioning without the Wi-Fi module', body: 'Control a unit that only has a remote, without the Wi-Fi option sold separately.' },
      { title: 'Somfy RTS shutters', body: 'Control radio shutters without buying another hub.' },
    ],
    soon: 'Soon',
  },
};

const LISTED: readonly ContentPageId[] = ['how-it-works', 'ideas'];

export function GuidesHubPage({ locale }: ContentPageProps): React.JSX.Element {
  const copy = COPY[locale];
  return (
    <ContentShell id="guides" locale={locale}>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> {copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="content-lede">{copy.lede}</p>
      </header>

      <section className="content-section">
        <div className="content-cards content-cards--links">
          {CONTENT_PAGES.filter((page) => LISTED.includes(page.id)).map((page) => (
            <a className="glass content-card-link" href={page.path[locale]} key={page.id}>
              <h2>{page.title[locale]}</h2>
              <p>{page.description[locale]}</p>
              <span>{copy.read} <span aria-hidden="true">→</span></span>
            </a>
          ))}
        </div>
      </section>

      <section className="content-section">
        <h2>{copy.nextTitle}</h2>
        <p>{copy.nextLede}</p>
        <div className="landing-grid">
          {copy.next.map((guide) => (
            <article className="glass" key={guide.title}>
              <span className="content-badge">{copy.soon}</span>
              <strong>{guide.title}</strong>
              <p>{guide.body}</p>
            </article>
          ))}
        </div>
      </section>
    </ContentShell>
  );
}
