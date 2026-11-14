// Turns the SPA build into indexable pages: the landing is rendered to static
// HTML at / (English) and /fr (French) with its SEO tags, every other route
// keeps the empty app shell (app.html) so /pair or /app never flash the landing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ORIGIN = 'https://www.miakapp.com';
const dist = resolve(process.argv[2] ?? 'dist');
const ssr = await import(pathToFileURL(resolve(process.argv[3] ?? 'dist-ssr/prerender.js')).href);
const shell = readFileSync(`${dist}/index.html`, 'utf8');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const PAGES = { en: { path: '/', file: 'index.html', ogLocale: 'en_US' }, fr: { path: '/fr', file: 'fr/index.html', ogLocale: 'fr_FR' } };

writeFileSync(`${dist}/app.html`, shell);

for (const [locale, page] of Object.entries(PAGES)) {
  const { title, description } = ssr.landingCopy(locale);
  const fullTitle = `Miakapp · ${title.replace(/\.$/, '')}`;
  const url = `${ORIGIN}${page.path}`;
  const head = [
    `<title>${escape(fullTitle)}</title>`,
    `<meta name="description" content="${escape(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="en" href="${ORIGIN}/" />`,
    `<link rel="alternate" hreflang="fr" href="${ORIGIN}/fr" />`,
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Miakapp" />`,
    `<meta property="og:locale" content="${page.ogLocale}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escape(fullTitle)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:image" content="${ORIGIN}/icons/icon-512.png" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');
  const html = shell
    .replace(/<html lang="[^"]*">/, `<html lang="${locale}">`)
    .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '')
    .replace(/<title>[\s\S]*?<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root">${ssr.renderLanding(locale)}</div>`);
  mkdirSync(resolve(dist, page.file, '..'), { recursive: true });
  writeFileSync(`${dist}/${page.file}`, html);
}

writeFileSync(`${dist}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${Object.values(PAGES).map((page) => `  <url>
    <loc>${ORIGIN}${page.path}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/" />
    <xhtml:link rel="alternate" hreflang="fr" href="${ORIGIN}/fr" />
  </url>`).join('\n')}
</urlset>
`);
process.stdout.write('prerendered /, /fr, app.html and sitemap.xml\n');
