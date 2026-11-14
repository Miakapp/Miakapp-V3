/**
 * The indexable content pages: their addresses, titles and descriptions in
 * every language. Each page is rendered to static HTML at build time by
 * scripts/prerender.mjs and listed in the sitemap; the pages ship no script.
 *
 * English lives at the root and French under `/fr`, with French slugs, so an
 * address reads naturally in the language of the page it names.
 */
import type { Locale } from '../app/copy';

export type ContentPageId = 'guides' | 'how-it-works' | 'ideas';

export interface ContentPageMeta {
  readonly id: ContentPageId;
  readonly path: Readonly<Record<Locale, string>>;
  /** Shown in <title>, Open Graph and the footer; the page's own h1 may say more. */
  readonly title: Readonly<Record<Locale, string>>;
  readonly description: Readonly<Record<Locale, string>>;
}

export const CONTENT_PAGES: readonly ContentPageMeta[] = [
  {
    id: 'guides',
    path: { en: '/guides', fr: '/fr/guides' },
    title: { en: 'Guides', fr: 'Guides' },
    description: {
      en: 'How Miakapp works, what to ask your home agent, and how to free your devices from their proprietary boxes.',
      fr: 'Comment fonctionne Miakapp, quoi demander à l’agent de votre maison, et comment libérer vos appareils de leurs boîtiers propriétaires.',
    },
  },
  {
    id: 'how-it-works',
    path: { en: '/how-it-works', fr: '/fr/comment-ca-marche' },
    title: { en: 'How it works', fr: 'Comment ça marche' },
    description: {
      en: 'Miakapp does four things: it hosts your home’s app, signs in the people who live there, sends push notifications and keeps working on the local network. Your agent builds everything else.',
      fr: 'Miakapp fait quatre choses : héberger l’app de la maison, connecter ses habitants, envoyer les notifications et tenir en réseau local. Votre agent construit tout le reste.',
    },
  },
  {
    id: 'ideas',
    path: { en: '/ideas', fr: '/fr/idees' },
    title: { en: 'What you can ask your agent', fr: 'Ce que vous pouvez demander à votre agent' },
    description: {
      en: 'Not “close the shutters at 8 pm”. Weather, energy tariffs, calendars, GPS, devices with no API, a screen for each person: real requests for a home agent that writes code.',
      fr: 'Pas « ferme les volets à 20 h ». Météo, Tempo, agenda, GPS, appareils sans API, un écran par habitant : de vraies demandes pour un agent qui écrit du code.',
    },
  },
];

export function contentPage(id: ContentPageId): ContentPageMeta {
  const page = CONTENT_PAGES.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Unknown content page ${id}`);
  return page;
}

/** App routes the static pages link to. They are served by the app shell and
 *  pick their language from the visitor, so they have one address. */
export const APP_LINKS = {
  landing: { en: '/', fr: '/fr' },
  signIn: '/login',
  newHome: '/new-home',
} as const;

export const SOURCE_URL = 'https://github.com/Miakapp/Miakapp-V3';
