import { describe, expect, it } from 'vitest';

import { LOCALES } from '../app/copy';
import { contentPages, renderContent, renderLanding } from '../prerender';

describe('content pages', () => {
  it('gives every page a distinct address in each language, French under /fr', () => {
    const paths = contentPages().flatMap((page) => LOCALES.map((locale) => page.path[locale]));
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of contentPages()) {
      expect(page.path.fr.startsWith('/fr/')).toBe(true);
      expect(page.path.en.startsWith('/fr')).toBe(false);
    }
  });

  it('renders each page in each language, with its language switch pointing at its twin', () => {
    for (const page of contentPages()) {
      for (const locale of LOCALES) {
        const html = renderContent(page.id, locale);
        expect(html).toContain('<h1');
        for (const other of LOCALES) expect(html).toContain(`href="${page.path[other]}"`);
      }
    }
  });

  it('links every page from the landing footer, and every guide from the hub', () => {
    for (const locale of LOCALES) {
      const landing = renderLanding(locale);
      const hub = renderContent('guides', locale);
      for (const page of contentPages()) {
        expect(page.kind === 'page' ? landing : hub).toContain(`href="${page.path[locale]}"`);
      }
    }
  });

});

describe('device guides', () => {
  it('cites only sources that exist, in both languages', async () => {
    const { GUIDES } = await import('./guides');
    for (const guide of Object.values(GUIDES)) {
      for (const locale of LOCALES) {
        const text = JSON.stringify(guide.copy[locale]);
        for (const [, n] of text.matchAll(/\[(\d+)\]/g)) {
          expect(Number(n)).toBeGreaterThanOrEqual(1);
          expect(Number(n)).toBeLessThanOrEqual(guide.sources.length);
        }
      }
    }
  });

  it('keeps drafts out of the published pages', async () => {
    const { CONTENT_PAGES, publishedPages } = await import('./site');
    const drafts = CONTENT_PAGES.filter((page) => page.draft).map((page) => page.id);
    for (const page of publishedPages(false)) expect(drafts).not.toContain(page.id);
  });
});
