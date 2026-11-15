/**
 * The indexable content pages: their addresses, titles and descriptions in
 * every language. Each page is rendered to static HTML at build time by
 * scripts/prerender.mjs and listed in the sitemap; the pages ship no script.
 *
 * English lives at the root and French under `/fr`, with French slugs, so an
 * address reads naturally in the language of the page it names.
 */
import type { Locale } from '../app/copy';

export type GuideId = 'guide-velux' | 'guide-toshiba-ac' | 'guide-somfy-rts';
export type CompareId = 'compare-home-assistant' | 'compare-jeedom' | 'compare-homey' | 'compare-google-home';
export type ContentPageId = 'guides' | 'how-it-works' | 'ideas' | GuideId | CompareId;

export interface ContentPageMeta {
  readonly id: ContentPageId;
  readonly path: Readonly<Record<Locale, string>>;
  /** Shown in <title>, Open Graph and the footer; the page's own h1 may say more. */
  readonly title: Readonly<Record<Locale, string>>;
  readonly description: Readonly<Record<Locale, string>>;
  /** Guides and comparisons are listed on the hub; plain pages in the footer. */
  readonly kind: 'page' | 'guide' | 'compare';
  /** Not published yet: left out of the build, the sitemap and every link
   *  unless drafts are previewed. A guide is published once Mathieu approved it. */
  readonly draft?: boolean;
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
    kind: 'page',
  },
  {
    id: 'how-it-works',
    path: { en: '/how-it-works', fr: '/fr/comment-ca-marche' },
    title: { en: 'How it works', fr: 'Comment ça marche' },
    description: {
      en: 'Miakapp does four things: it hosts your home’s app, signs in the people who live there, sends push notifications and keeps working on the local network. Your agent builds everything else.',
      fr: 'Miakapp fait quatre choses : héberger l’app de la maison, connecter ses habitants, envoyer les notifications et tenir en réseau local. Votre agent construit tout le reste.',
    },
    kind: 'page',
  },
  {
    id: 'ideas',
    path: { en: '/ideas', fr: '/fr/idees' },
    title: { en: 'What you can ask your agent', fr: 'Ce que vous pouvez demander à votre agent' },
    description: {
      en: 'Not “close the shutters at 8 pm”. Weather, energy tariffs, calendars, GPS, devices with no API, a screen for each person: real requests for a home agent that writes code.',
      fr: 'Pas « ferme les volets à 20 h ». Météo, Tempo, agenda, GPS, appareils sans API, un écran par habitant : de vraies demandes pour un agent qui écrit du code.',
    },
    kind: 'page',
  },
  {
    id: 'guide-velux',
    path: { en: '/guides/velux-without-official-hub', fr: '/fr/guides/velux-sans-boitier-officiel' },
    title: { en: 'Velux without the official hub', fr: 'Velux sans le boîtier officiel' },
    description: {
      en: 'Control Velux INTEGRA roof windows directly by radio, without the official hub: a €25 board that speaks io-homecontrol, with real position and rain sensor.',
      fr: 'Piloter ses fenêtres de toit Velux INTEGRA directement par radio, sans le boîtier officiel : une carte à 25 € qui parle io-homecontrol, position réelle et capteur de pluie compris.',
    },
    kind: 'guide',
  },
  {
    id: 'guide-toshiba-ac',
    path: { en: '/guides/toshiba-air-conditioner-without-wifi-module', fr: '/fr/guides/clim-toshiba-sans-module-wifi' },
    title: { en: 'Toshiba air conditioning without the Wi-Fi module', fr: 'Clim Toshiba sans le module Wi-Fi' },
    description: {
      en: 'Control a Toshiba air conditioner from your phone without the official Wi-Fi adapter: infrared or a direct link to the unit, with prices.',
      fr: 'Piloter une clim Toshiba depuis votre téléphone sans l’adaptateur Wi-Fi officiel : infrarouge ou liaison directe avec l’unité, prix compris.',
    },
    kind: 'guide',
  },
  {
    id: 'guide-somfy-rts',
    path: { en: '/guides/somfy-rts-without-hub', fr: '/fr/guides/volets-somfy-rts-sans-box' },
    title: { en: 'Somfy RTS shutters without a hub', fr: 'Volets Somfy RTS sans box' },
    description: {
      en: 'Control Somfy RTS shutters and awnings without a Somfy hub: an ESP32 and a radio module registered as one more remote.',
      fr: 'Commander des volets et stores Somfy RTS sans box Somfy : un ESP32 et un module radio enregistrés comme une télécommande de plus.',
    },
    kind: 'guide',
  },
  {
    id: 'compare-home-assistant',
    path: { en: '/compare/home-assistant', fr: '/fr/comparatif/home-assistant' },
    title: { en: 'Miakapp vs Home Assistant', fr: 'Miakapp ou Home Assistant' },
    description: {
      en: 'An honest comparison of Miakapp and Home Assistant: what Home Assistant does better, where Miakapp differs, and how to use both.',
      fr: 'Comparatif honnête entre Miakapp et Home Assistant : ce que Home Assistant fait mieux, où Miakapp diffère, et comment utiliser les deux.',
    },
    kind: 'compare',
    draft: true,
  },
  {
    id: 'compare-jeedom',
    path: { en: '/compare/jeedom', fr: '/fr/comparatif/jeedom' },
    title: { en: 'Miakapp vs Jeedom', fr: 'Miakapp ou Jeedom' },
    description: {
      en: 'An honest comparison of Miakapp and Jeedom: plugins and scenarios against a home written by an agent, and how to use both.',
      fr: 'Comparatif honnête entre Miakapp et Jeedom : plugins et scénarios face à une maison écrite par un agent, et comment utiliser les deux.',
    },
    kind: 'compare',
    draft: true,
  },
  {
    id: 'compare-homey',
    path: { en: '/compare/homey', fr: '/fr/comparatif/homey' },
    title: { en: 'Miakapp vs Homey', fr: 'Miakapp ou Homey' },
    description: {
      en: 'An honest comparison of Miakapp and Homey: an all-in-one box against a foundation an agent builds on, with prices.',
      fr: 'Comparatif honnête entre Miakapp et Homey : une box tout-en-un face à un socle sur lequel un agent construit, prix compris.',
    },
    kind: 'compare',
    draft: true,
  },
  {
    id: 'compare-google-home',
    path: { en: '/compare/google-home', fr: '/fr/comparatif/google-home' },
    title: { en: 'Miakapp vs Google Home', fr: 'Miakapp ou Google Home' },
    description: {
      en: 'An honest comparison of Miakapp and Google Home: simple routines and voice against custom logic, rights and interface.',
      fr: 'Comparatif honnête entre Miakapp et Google Home : routines simples et voix face à une logique, des droits et une interface sur mesure.',
    },
    kind: 'compare',
    draft: true,
  },
];

/** Drafts are previewed by prerendering with MIAKAPP_PREVIEW_DRAFTS=1; the
 *  browser bundle never sees them. */
const PREVIEW_DRAFTS = typeof process !== 'undefined' && process.env.MIAKAPP_PREVIEW_DRAFTS === '1';

export function publishedPages(includeDrafts = PREVIEW_DRAFTS): readonly ContentPageMeta[] {
  return CONTENT_PAGES.filter((page) => includeDrafts || !page.draft);
}

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

export const SOURCE_URL = 'https://github.com/Miakapp/Miakapp';
