// Server-side render of the public pages, built with `vite build --ssr` and
// written into static HTML by scripts/prerender.mjs: the landing, which the
// app takes over in the browser, and the content pages, which ship no script.
import { renderToString } from 'react-dom/server';

import { COPY, type Locale } from './app/copy';
import { LandingPage } from './app/product-app';
import { GuidesHubPage } from './content/guides-hub';
import { HowItWorksPage } from './content/how-it-works';
import { IdeasPage } from './content/ideas';
import { DeviceGuidePage, type DeviceGuide } from './content/device-guide';
import { GUIDES } from './content/guides';
import { publishedPages, type ContentPageId, type GuideId } from './content/site';

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

type PageRenderer = (props: { readonly locale: Locale }) => React.JSX.Element;

const PAGE_RENDERERS: Record<Exclude<ContentPageId, GuideId>, PageRenderer> = {
  'guides': GuidesHubPage,
  'how-it-works': HowItWorksPage,
  'ideas': IdeasPage,
};

/** The pages this build publishes; drafts only when previewing them. */
export function contentPages(): ReturnType<typeof publishedPages> {
  return publishedPages();
}

export function renderContent(id: ContentPageId, locale: Locale): string {
  if (id in GUIDES) {
    const guide: DeviceGuide = GUIDES[id as GuideId];
    return renderToString(<DeviceGuidePage guide={guide} locale={locale} />);
  }
  const Page = PAGE_RENDERERS[id as Exclude<ContentPageId, GuideId>];
  return renderToString(<Page locale={locale} />);
}
