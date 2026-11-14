import type { Locale } from '../app/copy';
import { APP_LINKS, contentPage, type ContentPageId } from './site';
import { Ask, ContentShell } from './site-chrome';

/** A source a claim of the guide rests on. Numbered in order of appearance;
 *  the text cites them as [n]. */
export interface GuideSource {
  readonly label: string;
  readonly url: string;
}

export interface GuideRoute {
  readonly name: string;
  /** One line: who this route is for. */
  readonly verdict: string;
  readonly body: readonly string[];
  readonly hardware: readonly { readonly item: string; readonly price: string }[];
  readonly total: string;
  readonly recommended?: boolean;
}

export interface GuideCopy {
  readonly kicker: string;
  readonly title: string;
  readonly titleAccent: string;
  readonly lede: string;
  readonly problemTitle: string;
  readonly problem: readonly string[];
  readonly howTitle: string;
  readonly how: readonly string[];
  readonly routesTitle: string;
  readonly routes: readonly GuideRoute[];
  readonly askTitle: string;
  readonly asks: readonly string[];
  readonly agentTitle: string;
  readonly agent: readonly string[];
  readonly caveatsTitle: string;
  readonly caveats: readonly string[];
  readonly pricesNote: string;
}

export interface DeviceGuide {
  readonly id: ContentPageId;
  readonly copy: Readonly<Record<Locale, GuideCopy>>;
  readonly sources: readonly GuideSource[];
  /** Month the prices and project states were last checked, e.g. 2026-11. */
  readonly checked: string;
}

const WORDS = {
  fr: {
    hardware: 'Matériel',
    price: 'Prix indicatif',
    total: 'Total',
    recommended: 'Notre conseil',
    sources: 'Sources',
    checked: 'Prix et projets vérifiés en',
    closingTitle: 'Confiez-le à votre agent',
    closingBody: 'Créez la maison, connectez votre agent et donnez-lui ce guide comme point de départ.',
    closingCta: 'Créer ma maison',
    closingLink: 'Tous les guides',
  },
  en: {
    hardware: 'Hardware',
    price: 'Typical price',
    total: 'Total',
    recommended: 'Our pick',
    sources: 'Sources',
    checked: 'Prices and projects checked in',
    closingTitle: 'Hand it to your agent',
    closingBody: 'Create the home, connect your agent and give it this guide as a starting point.',
    closingCta: 'Create my home',
    closingLink: 'All guides',
  },
} as const satisfies Record<Locale, Record<string, string>>;

function checkedMonth(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Turns the [n] citations of a paragraph into links to the source list. */
function Cited({ text }: { readonly text: string }): React.JSX.Element {
  const parts = text.split(/(\[\d+\])/);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        if (!match) return part;
        return <sup key={index}><a className="content-cite" href={`#source-${match[1]}`}>{match[1]}</a></sup>;
      })}
    </>
  );
}

function Paragraphs({ items }: { readonly items: readonly string[] }): React.JSX.Element {
  return <>{items.map((text) => <p key={text}><Cited text={text} /></p>)}</>;
}

export function DeviceGuidePage({ guide, locale }: { readonly guide: DeviceGuide; readonly locale: Locale }): React.JSX.Element {
  const copy = guide.copy[locale];
  const words = WORDS[locale];
  const at = copy.title.indexOf(copy.titleAccent);
  return (
    <ContentShell id={guide.id} locale={locale}>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> {copy.kicker}</p>
        <h1>
          {at < 0 ? copy.title : <>{copy.title.slice(0, at)}<em>{copy.titleAccent}</em>{copy.title.slice(at + copy.titleAccent.length)}</>}
        </h1>
        <p className="content-lede">{copy.lede}</p>
      </header>

      <section className="content-section">
        <h2>{copy.problemTitle}</h2>
        <Paragraphs items={copy.problem} />
      </section>

      <section className="content-section">
        <h2>{copy.howTitle}</h2>
        <Paragraphs items={copy.how} />
      </section>

      <section className="content-section">
        <h2>{copy.routesTitle}</h2>
        <div className="content-routes">
          {copy.routes.map((route) => (
            <article className={route.recommended ? 'glass is-recommended' : 'glass'} key={route.name}>
              {route.recommended ? <span className="content-badge">{words.recommended}</span> : null}
              <h3>{route.name}</h3>
              <p className="content-route__verdict">{route.verdict}</p>
              {route.body.map((text) => <p key={text}><Cited text={text} /></p>)}
              <table className="content-table">
                <thead><tr><th>{words.hardware}</th><th>{words.price}</th></tr></thead>
                <tbody>
                  {route.hardware.map((line) => (
                    <tr key={line.item}><td><Cited text={line.item} /></td><td><Cited text={line.price} /></td></tr>
                  ))}
                </tbody>
                <tfoot><tr><th>{words.total}</th><th>{route.total}</th></tr></tfoot>
              </table>
            </article>
          ))}
        </div>
        <p className="content-small">{copy.pricesNote}</p>
      </section>

      <section className="content-section">
        <h2>{copy.askTitle}</h2>
        {copy.asks.map((ask) => <Ask key={ask} locale={locale}>{ask}</Ask>)}
      </section>

      <section className="content-section">
        <h2>{copy.agentTitle}</h2>
        <ul className="content-list">
          {copy.agent.map((text) => <li key={text}><Cited text={text} /></li>)}
        </ul>
      </section>

      <section className="content-section">
        <h2>{copy.caveatsTitle}</h2>
        <ul className="content-list">
          {copy.caveats.map((text) => <li key={text}><Cited text={text} /></li>)}
        </ul>
      </section>

      <section className="content-section">
        <h2>{words.sources}</h2>
        <ol className="content-sources">
          {guide.sources.map((source, index) => (
            <li id={`source-${index + 1}`} key={source.url}>
              <a href={source.url} rel="noopener">{source.label}</a>
            </li>
          ))}
        </ol>
        <p className="content-small">{words.checked} {checkedMonth(guide.checked, locale)}.</p>
      </section>

      <section className="landing-closing content-closing">
        <div>
          <h2>{words.closingTitle}</h2>
          <p>{words.closingBody}</p>
        </div>
        <div className="content-closing__actions">
          <a className="product-button product-button--light" href={APP_LINKS.newHome}>{words.closingCta} <span aria-hidden="true">→</span></a>
          <a className="content-closing__link" href={contentPage('guides').path[locale]}>{words.closingLink}</a>
        </div>
      </section>
    </ContentShell>
  );
}
