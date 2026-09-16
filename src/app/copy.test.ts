import { describe, expect, it } from 'vitest';

import {
  COPY,
  LOCALES,
  LOCALE_LABELS,
  readStoredLocale,
  resolveLocale,
  writeStoredLocale,
  type Locale,
} from './copy';

describe('product copy', () => {
  it('answers every key in every language', () => {
    // The type system already refuses a missing key. This is the other half:
    // a key answered with an empty string type-checks and ships a blank page.
    const keys = Object.keys(COPY.fr).sort();
    expect(keys.length).toBeGreaterThan(40);

    for (const locale of LOCALES) {
      expect(Object.keys(COPY[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(COPY[locale][key as keyof typeof COPY.fr]!.trim()).not.toBe('');
      }
    }
  });

  it('does not ship one language pretending to be another', () => {
    // A copy-paste that leaves a French sentence in the English table is the
    // failure the type system cannot see, so it is checked by value.
    const shared = new Set(['Miakapp']);
    let identical = 0;
    for (const key of Object.keys(COPY.fr) as Array<keyof typeof COPY.fr>) {
      if (COPY.fr[key] === COPY.en[key] && !shared.has(COPY.fr[key])) identical += 1;
    }
    expect(identical).toBe(0);
  });

  it('names each language in its own language', () => {
    expect(LOCALE_LABELS.fr).toBe('Français');
    expect(LOCALE_LABELS.en).toBe('English');
  });
});

describe('resolveLocale', () => {
  it('prefers a stated choice over the browser', () => {
    expect(resolveLocale('en', ['fr-FR'])).toBe('en');
    expect(resolveLocale('fr', ['en-GB'])).toBe('fr');
  });

  it('matches on the primary subtag, so a Belgian browser is French', () => {
    expect(resolveLocale(null, ['fr-BE'])).toBe('fr');
    expect(resolveLocale(null, ['FR-ca'])).toBe('fr');
  });

  it('walks the whole preference list rather than only the first entry', () => {
    expect(resolveLocale(null, ['ja', 'de', 'fr-FR'])).toBe('fr');
  });

  it('falls back to English rather than to a half-understood language', () => {
    expect(resolveLocale(null, ['ja-JP'])).toBe('en');
    expect(resolveLocale(null, [])).toBe('en');
  });

  it('ignores a stored value that is no longer a language we ship', () => {
    expect(resolveLocale('de', ['fr'])).toBe('fr');
    expect(resolveLocale('', ['fr'])).toBe('fr');
  });
});

describe('locale storage', () => {
  function memoryStorage(): Storage {
    const entries = new Map<string, string>();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => void entries.set(key, value),
      removeItem: (key) => void entries.delete(key),
      clear: () => entries.clear(),
      key: () => null,
      get length() {
        return entries.size;
      },
    } as Storage;
  }

  it('remembers a choice across visits', () => {
    const storage = memoryStorage();
    writeStoredLocale(storage, 'fr');
    expect(resolveLocale(readStoredLocale(storage), ['en-US'])).toBe('fr');
  });

  it('keeps working when the browser refuses storage', () => {
    // Private mode throws on both calls. A language switch that throws would
    // take the page down over a preference.
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(readStoredLocale(refusing)).toBeNull();
    expect(() => writeStoredLocale(refusing, 'fr' as Locale)).not.toThrow();
  });

  it('survives an environment with no storage at all', () => {
    expect(readStoredLocale(undefined)).toBeNull();
    expect(() => writeStoredLocale(undefined, 'en')).not.toThrow();
  });
});
