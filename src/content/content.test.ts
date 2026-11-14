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

  it('links every content page from the landing footer', () => {
    for (const locale of LOCALES) {
      const html = renderLanding(locale);
      for (const page of contentPages()) expect(html).toContain(`href="${page.path[locale]}"`);
    }
  });

});
