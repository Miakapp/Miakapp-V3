import type { Locale } from '../app/copy';
import { Cited, type GuideSource } from './device-guide';
import { APP_LINKS, contentPage, type ContentPageId } from './site';
import { ContentShell } from './site-chrome';

export interface CompareRow {
  readonly criterion: string;
  readonly them: string;
  readonly miakapp: string;
}

export interface CompareCopy {
  readonly kicker: string;
  readonly title: string;
  readonly titleAccent: string;
  readonly lede: string;
  readonly summaryTitle: string;
  readonly summary: readonly string[];
  readonly tableTitle: string;
  readonly rows: readonly CompareRow[];
  readonly themBetterTitle: string;
  readonly themBetter: readonly string[];
  readonly miakappDifferentTitle: string;
  readonly miakappDifferent: readonly string[];
  readonly togetherTitle: string;
  readonly together: readonly string[];
  readonly chooseTitle: string;
  readonly chooseThem: string;
  readonly chooseMiakapp: string;
}

export interface Comparison {
  readonly id: ContentPageId;
  /** The product compared, as it names itself. */
  readonly name: string;
  readonly copy: Readonly<Record<Locale, CompareCopy>>;
  readonly sources: readonly GuideSource[];
  readonly checked: string;
}

const WORDS = {
  fr: {
    criterion: 'Critère',
    sources: 'Sources',
    checked: 'Informations vérifiées en',
    closingTitle: 'Essayez avec votre agent',
    closingBody: 'Créez la maison, connectez votre agent et demandez-lui ce que votre installation actuelle ne sait pas faire.',
    closingCta: 'Créer ma maison',
    closingLink: 'Tous les guides',
  },
  en: {
    criterion: 'Criterion',
    sources: 'Sources',
    checked: 'Information checked in',
    closingTitle: 'Try it with your agent',
    closingBody: 'Create the home, connect your agent and ask it for what your current setup cannot do.',
    closingCta: 'Create my home',
    closingLink: 'All guides',
  },
} as const satisfies Record<Locale, Record<string, string>>;

function month(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
}

function List({ items }: { readonly items: readonly string[] }): React.JSX.Element {
  return <ul className="content-list">{items.map((text) => <li key={text}><Cited text={text} /></li>)}</ul>;
}

export function ComparePage({ comparison, locale }: { readonly comparison: Comparison; readonly locale: Locale }): React.JSX.Element {
  const copy = comparison.copy[locale];
  const words = WORDS[locale];
  const at = copy.title.indexOf(copy.titleAccent);
  return (
    <ContentShell id={comparison.id} locale={locale}>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> {copy.kicker}</p>
        <h1>
          {at < 0 ? copy.title : <>{copy.title.slice(0, at)}<em>{copy.titleAccent}</em>{copy.title.slice(at + copy.titleAccent.length)}</>}
        </h1>
        <p className="content-lede">{copy.lede}</p>
      </header>

      <section className="content-section">
        <h2>{copy.summaryTitle}</h2>
        {copy.summary.map((text) => <p key={text}><Cited text={text} /></p>)}
      </section>

      <section className="content-section">
        <h2>{copy.tableTitle}</h2>
        <div className="glass content-compare">
          <table className="content-table">
            <thead>
              <tr><th>{words.criterion}</th><th>{comparison.name}</th><th>Miakapp</th></tr>
            </thead>
            <tbody>
              {copy.rows.map((row) => (
                <tr key={row.criterion}>
                  <th scope="row">{row.criterion}</th>
                  <td><Cited text={row.them} /></td>
                  <td><Cited text={row.miakapp} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <h2>{copy.themBetterTitle}</h2>
        <List items={copy.themBetter} />
      </section>

      <section className="content-section">
        <h2>{copy.miakappDifferentTitle}</h2>
        <List items={copy.miakappDifferent} />
      </section>

      <section className="content-section">
        <h2>{copy.togetherTitle}</h2>
        {copy.together.map((text) => <p key={text}><Cited text={text} /></p>)}
      </section>

      <section className="content-section">
        <h2>{copy.chooseTitle}</h2>
        <div className="content-cards">
          <article className="glass"><h3>{comparison.name}</h3><p><Cited text={copy.chooseThem} /></p></article>
          <article className="glass"><h3>Miakapp</h3><p><Cited text={copy.chooseMiakapp} /></p></article>
        </div>
      </section>

      <section className="content-section">
        <h2>{words.sources}</h2>
        <ol className="content-sources">
          {comparison.sources.map((source, index) => (
            <li id={`source-${index + 1}`} key={source.url}>
              <a href={source.url} rel="noopener">{source.label}</a>
            </li>
          ))}
        </ol>
        <p className="content-small">{words.checked} {month(comparison.checked, locale)}.</p>
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
