// Server-side render of the landing page, built with `vite build --ssr` and
// written into static HTML by scripts/prerender.mjs.
import { renderToString } from 'react-dom/server';

import { COPY, type Locale } from './app/copy';
import { LandingPage } from './app/product-app';

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
