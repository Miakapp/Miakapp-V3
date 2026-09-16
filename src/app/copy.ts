/**
 * Every string the public product surface shows, in every language it shows
 * them in.
 *
 * The shape is the guarantee. `COPY.fr` defines the key set; `Copy` is derived
 * from it and every locale is typed as a total record over that set, so a
 * missing translation is a type error rather than a French sentence surfacing
 * in an English page. Adding a language means adding a member to `LOCALES` and
 * being unable to compile until every key is answered.
 *
 * Only the public surface lives here — landing, sign-in, new home. The signed-in
 * console is still English-only, and its semantic trees come from the home's own
 * coordinator rather than from this file, so translating it is a separate piece
 * of work with a separate owner.
 */

export const LOCALES = ['fr', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
};

const FR = {
  localeSwitchLabel: 'Langue',

  navSignIn: 'Se connecter',
  navCreate: 'Créer ma maison',

  landingKicker: 'Le framework domotique de votre agent',
  landingTitle: 'Votre agent de code construit votre domotique.',
  landingLede:
    'Miakapp donne à un agent de code tout ce qu’il faut pour lire votre installation, '
    + 'écrire vos automatisations et construire votre interface. Vous décrivez ce que vous '
    + 'voulez ; il l’implémente, le teste, et vous l’explique.',
  landingPrimaryCta: 'Créer ma maison',
  landingSecondaryCta: 'Voir la maison de démonstration',
  landingProofLabel: 'Ce que votre agent prend en charge',
  landingProofOne: 'Vos appareils',
  landingProofTwo: 'Vos automatisations',
  landingProofThree: 'Votre interface',

  landingCardHome: 'Maison Horizon',
  landingCardCalm: 'Tout est calme',
  landingCardLive: 'En direct',
  landingCardRoom: 'Salon',
  landingCardEnergy: 'Énergie',
  landingCardBattery: 'Batterie',
  landingCardLight: 'Éclairage du salon',
  landingCardVisualLabel: 'Aperçu d’une maison Miakapp',
  landingAgentNote: 'Construit par votre agent',
  landingAgentNoteDetail: 'Modifiable à tout moment',

  audiencesKicker: 'Pour trois maisons très différentes',
  audiencesTitle: 'Que vous ayez tout câblé vous-même ou jamais rien branché.',
  audienceTinkererTitle: 'Vous bricolez déjà',
  audienceTinkererBody:
    'Vos automatisations vivent dans votre dépôt, écrites et testées par votre agent '
    + 'au lieu d’être cliquées une par une. Allez plus loin, plus vite.',
  audienceCuriousTitle: 'Vous avez quelques appareils',
  audienceCuriousBody:
    'Un Google Home et deux prises, c’est un point de départ, pas un plafond. Votre '
    + 'agent relie ce que vous avez déjà et construit ce qui vous manque.',
  audienceNewcomerTitle: 'Vous n’y avez jamais touché',
  audienceNewcomerBody:
    'Vous n’avez pas à apprendre la domotique. Votre agent lit la maison, propose, '
    + 'explique, et n’agit qu’avec votre accord.',

  principlesKicker: 'Pas une app domotique de plus',
  principlesTitle: 'Miakapp sépare ce qui doit rester stable de ce qui doit rester libre.',
  principleBaseTitle: 'Le socle protège',
  principleBaseBody: 'Identité, permissions, connexion et exécution restent dans un hôte de confiance.',
  principleAgentTitle: 'L’agent construit',
  principleAgentBody: 'Automatisations, pages et composants vivent dans votre dépôt et évoluent avec vous.',
  principleHomeTitle: 'La maison répond',
  principleHomeBody: 'Les coordinateurs exposent les états et les actions. Ils ne décident jamais de l’interface.',

  loginKicker: 'Espace personnel',
  loginTitle: 'Retrouvez votre maison.',
  loginLede: 'Connectez-vous pour ouvrir une installation existante.',
  loginGoogle: 'Continuer avec Google',
  loginPrivacy:
    'Miakapp utilise votre identité pour ouvrir uniquement les maisons auxquelles vous avez accès.',
  loginBack: '← Retour à l’accueil',

  onboardingKicker: 'Nouvelle maison',
  onboardingTitle: 'Donnez ce point de départ à votre agent.',
  onboardingLede:
    'Il installera le guide Miakapp, découvrira votre installation, écrira vos '
    + 'automatisations et construira votre interface dans votre propre dépôt.',
  onboardingPromptKicker: 'Claude Code ou Codex',
  onboardingPromptTitle: 'Copiez ce prompt',
  onboardingCopy: 'Copier le prompt',
  onboardingCopied: 'Prompt copié',
  onboardingCopyFailed: 'Copie impossible. Sélectionnez le prompt ci-dessus.',
  onboardingRecommended: 'Recommandé',
  onboardingMoltedTitle: 'Ou laissez Molted préparer l’agent',
  onboardingMoltedBody: 'Un espace prêt à l’emploi, sans terminal ni infrastructure à maintenir.',
  onboardingMoltedCta: 'Utiliser dans molted.cloud',
  onboardingAccountTitle: 'Le compte vient plus tard, et c’est voulu.',
  onboardingAccountBody:
    'Votre agent travaille d’abord. Quand il aura besoin d’émettre la clé de votre '
    + 'maison, il vous enverra un lien — c’est à ce moment-là que vous créerez votre '
    + 'compte Miakapp. Rien à signer pour commencer à lire le guide.',
  onboardingHasHome: 'J’ai déjà une maison →',
} as const;

export type CopyKey = keyof typeof FR;

const EN: Record<CopyKey, string> = {
  localeSwitchLabel: 'Language',

  navSignIn: 'Sign in',
  navCreate: 'Create my home',

  landingKicker: 'The home-automation framework your agent builds with',
  landingTitle: 'Your coding agent builds your smart home.',
  landingLede:
    'Miakapp gives a coding agent everything it needs to read your installation, write '
    + 'your automations and build your interface. You describe what you want; it '
    + 'implements it, tests it, and explains it back to you.',
  landingPrimaryCta: 'Create my home',
  landingSecondaryCta: 'See the demo home',
  landingProofLabel: 'What your agent takes on',
  landingProofOne: 'Your devices',
  landingProofTwo: 'Your automations',
  landingProofThree: 'Your interface',

  landingCardHome: 'Horizon House',
  landingCardCalm: 'All quiet',
  landingCardLive: 'Live',
  landingCardRoom: 'Living room',
  landingCardEnergy: 'Energy',
  landingCardBattery: 'Battery',
  landingCardLight: 'Living room lights',
  landingCardVisualLabel: 'Preview of a Miakapp home',
  landingAgentNote: 'Built by your agent',
  landingAgentNoteDetail: 'Changeable at any time',

  audiencesKicker: 'For three very different houses',
  audiencesTitle: 'Whether you wired it all yourself or have never plugged anything in.',
  audienceTinkererTitle: 'You already tinker',
  audienceTinkererBody:
    'Your automations live in your repository, written and tested by your agent instead '
    + 'of clicked together one at a time. Go further, faster.',
  audienceCuriousTitle: 'You have a few devices',
  audienceCuriousBody:
    'A Google Home and two smart plugs is a starting point, not a ceiling. Your agent '
    + 'connects what you already own and builds what you are missing.',
  audienceNewcomerTitle: 'You have never touched it',
  audienceNewcomerBody:
    'You do not have to learn home automation. Your agent reads the house, proposes, '
    + 'explains, and acts only with your consent.',

  principlesKicker: 'Not one more smart-home app',
  principlesTitle: 'Miakapp separates what must stay stable from what must stay yours.',
  principleBaseTitle: 'The platform protects',
  principleBaseBody: 'Identity, permissions, transport and execution stay inside a trusted host.',
  principleAgentTitle: 'The agent builds',
  principleAgentBody: 'Automations, pages and components live in your repository and change with you.',
  principleHomeTitle: 'The house answers',
  principleHomeBody: 'Coordinators expose state and actions. They never decide the interface.',

  loginKicker: 'Your account',
  loginTitle: 'Open your home.',
  loginLede: 'Sign in to open an installation you already have.',
  loginGoogle: 'Continue with Google',
  loginPrivacy: 'Miakapp uses your identity to open only the homes you have access to.',
  loginBack: '← Back to home page',

  onboardingKicker: 'New home',
  onboardingTitle: 'Give your agent this starting point.',
  onboardingLede:
    'It will install the Miakapp guide, discover your installation, write your '
    + 'automations and build your interface inside your own repository.',
  onboardingPromptKicker: 'Claude Code or Codex',
  onboardingPromptTitle: 'Copy this prompt',
  onboardingCopy: 'Copy the prompt',
  onboardingCopied: 'Prompt copied',
  onboardingCopyFailed: 'Copying failed. Select the prompt above.',
  onboardingRecommended: 'Recommended',
  onboardingMoltedTitle: 'Or let Molted set the agent up',
  onboardingMoltedBody: 'A ready-made workspace, with no terminal and no infrastructure to maintain.',
  onboardingMoltedCta: 'Use in molted.cloud',
  onboardingAccountTitle: 'The account comes later, and that is deliberate.',
  onboardingAccountBody:
    'Your agent works first. When it needs to issue your home’s key it will send you a '
    + 'link — that is the moment you create your Miakapp account. Nothing to sign up for '
    + 'in order to start reading the guide.',
  onboardingHasHome: 'I already have a home →',
};

export const COPY: Record<Locale, Record<CopyKey, string>> = { fr: FR, en: EN };

const STORAGE_KEY = 'miakapp.locale';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The visitor's stated choice wins over the browser's, and the browser's over
 * English. Matching on the primary subtag rather than the full tag is what makes
 * `fr-CA` and `fr-BE` French; anything unrecognised is English rather than a
 * half-translated page.
 */
export function resolveLocale(
  stored: string | null,
  languages: readonly string[],
): Locale {
  if (isLocale(stored)) return stored;
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

/** Storage is a preference, never a requirement: a browser that refuses it still works. */
export function readStoredLocale(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(storage: Storage | undefined, locale: Locale): void {
  try {
    storage?.setItem(STORAGE_KEY, locale);
  } catch {
    // A private-mode browser refusing storage must not break a language switch.
  }
}
