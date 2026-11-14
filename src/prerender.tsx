// Server-side render of the public pages, built with `vite build --ssr` and
// written into static HTML by scripts/prerender.mjs: the landing, which the
// app takes over in the browser, and the content pages, which ship no script.
import { renderToString } from 'react-dom/server';

import { COPY, type Locale } from './app/copy';
import { LandingPage } from './app/product-app';
import { GuidesHubPage } from './content/guides-hub';
import { HowItWorksPage } from './content/how-it-works';
import { IdeasPage } from './content/ideas';
import { CONTENT_PAGES, type ContentPageId } from './content/site';

export function renderLanding(locale: Locale): string {
  return renderToString(
    <LandingPage
      locale={locale}
      onLocaleChange={() => undefined}
      onNavigate={() => undefined}
      t={(key) => COPY[locale][key]}
    />,
  );
}

export function landingCopy(locale: Locale): { readonly title: string; readonly description: string } {
  return { title: COPY[locale].landingTitle, description: COPY[locale].landingLede };
}

const CONTENT_RENDERERS: Record<ContentPageId, (props: { readonly locale: Locale }) => React.JSX.Element> = {
  'guides': GuidesHubPage,
  'how-it-works': HowItWorksPage,
  'ideas': IdeasPage,
};

export function contentPages(): typeof CONTENT_PAGES {
  return CONTENT_PAGES;
}

export function renderContent(id: ContentPageId, locale: Locale): string {
  const Page = CONTENT_RENDERERS[id];
  return renderToString(<Page locale={locale} />);
}
