// Turns the SPA build into indexable pages:
// - the landing is rendered to static HTML at / (English) and /fr (French),
//   and the app takes it over in the browser;
// - every content page (guides, how it works, ideas…) is rendered in both
//   languages to <path>.html, served at <path> by Hosting's cleanUrls, with no
//   script at all: it is a document, not an app;
// - every other route keeps the empty app shell (app.html) so /pair or /app
//   never flash the landing.
// Every page gets its canonical, hreflang and Open Graph tags, and the sitemap.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ORIGIN = 'https://www.miakapp.com';
const OG_LOCALE = { en: 'en_US', fr: 'fr_FR' };
const dist = resolve(process.argv[2] ?? 'dist');
const ssr = await import(pathToFileURL(resolve(process.argv[3] ?? 'dist-ssr/prerender.js')).href);
const shell = readFileSync(`${dist}/index.html`, 'utf8');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

writeFileSync(`${dist}/app.html`, shell);

/** @type {{ path: Record<string, string>, file: (locale: string) => string, title: (locale: string) => string, description: (locale: string) => string, body: (locale: string) => string, static: boolean, type: string }[]} */
const PAGES = [
  {
    path: { en: '/', fr: '/fr' },
    file: (locale) => (locale === 'fr' ? 'fr/index.html' : 'index.html'),
    title: (locale) => `Miakapp · ${ssr.landingCopy(locale).title.replace(/\.$/, '')}`,
    description: (locale) => ssr.landingCopy(locale).description,
    body: (locale) => ssr.renderLanding(locale),
    static: false,
    type: 'website',
  },
  ...ssr.contentPages().map((page) => ({
    path: page.path,
    file: (locale) => `${page.path[locale].slice(1)}.html`,
    title: (locale) => `${page.title[locale]} · Miakapp`,
    description: (locale) => page.description[locale],
    body: (locale) => ssr.renderContent(page.id, locale),
    static: true,
    type: 'article',
  })),
];

function alternates(page) {
  return [
    ...Object.entries(page.path).map(([locale, path]) => ({ hreflang: locale, href: `${ORIGIN}${path}` })),
    { hreflang: 'x-default', href: `${ORIGIN}${page.path.en}` },
  ];
}

for (const page of PAGES) {
  for (const [locale, path] of Object.entries(page.path)) {
    const title = page.title(locale);
    const description = page.description(locale);
    const url = `${ORIGIN}${path}`;
    const head = [
      `<title>${escape(title)}</title>`,
      `<meta name="description" content="${escape(description)}" />`,
      `<link rel="canonical" href="${url}" />`,
      ...alternates(page).map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${href}" />`),
      `<meta property="og:type" content="${page.type}" />`,
      `<meta property="og:site_name" content="Miakapp" />`,
      `<meta property="og:locale" content="${OG_LOCALE[locale]}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:title" content="${escape(title)}" />`,
      `<meta property="og:description" content="${escape(description)}" />`,
      `<meta property="og:image" content="${ORIGIN}/icons/icon-512.png" />`,
      `<meta name="twitter:card" content="summary" />`,
    ].join('\n    ');
    let html = shell
      .replace(/<html lang="[^"]*">/, `<html lang="${locale}">`)
      .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '')
      .replace(/<title>[\s\S]*?<\/title>/, head)
      .replace('<div id="root"></div>', `<div id="root">${page.body(locale)}</div>`);
    if (page.static) {
      // A content page is read, not run: no app bundle, no manifest prompt.
      html = html
        .replace(/\s*<script type="module"[^>]*><\/script>/g, '')
        .replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
    }
    const file = resolve(dist, page.file(locale));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
}

writeFileSync(`${dist}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${PAGES.flatMap((page) => Object.values(page.path).map((path) => `  <url>
    <loc>${ORIGIN}${path}</loc>
${alternates(page).map(({ hreflang, href }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`).join('\n')}
  </url>`)).join('\n')}
</urlset>
`);
process.stdout.write(`prerendered ${PAGES.flatMap((page) => Object.values(page.path)).join(', ')}, app.html and sitemap.xml\n`);
