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
 * Only the public surface lives here — landing, sign-in, new home, agent
 * pairing. The signed-in console is still English-only, and its semantic trees
 * come from the home's own coordinator rather than from this file, so
 * translating it is a separate piece of work with a separate owner.
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
  // The sentence is translated; the commands inside it are not, because an
  // agent runs them verbatim.
  onboardingAgentPrompt:
    'Installe la CLI `miakapp` via `npm i -g @miakapp/cli` puis fais `miakapp docs start` pour commencer.',

  pairKicker: 'Appairer un agent',
  pairTitle: 'Donnez à votre agent l’accès à votre maison.',
  pairLede:
    'Faites-le ici, dans votre propre navigateur : choisissez votre compte et la maison, '
    + 'confirmez, puis transmettez le code à votre agent. Il ne voit jamais votre compte.',
  pairUnavailableTitle: 'L’appairage n’est pas disponible ici.',
  pairUnavailableBody:
    'Cette version de démonstration n’est reliée à aucun service Miakapp. Ouvrez le lien '
    + 'd’appairage que votre agent vous a donné sur le site Miakapp.',
  pairLoading: 'Chargement…',
  pairStepAccount: 'Compte',
  pairStepHome: 'Maison',
  pairStepConfirm: 'Confirmation',
  pairStepCode: 'Code d’appairage',
  pairAccountTitle: 'Choisissez le compte qui administre la maison.',
  pairAccountBody: 'Google vous laissera choisir le compte. Rien n’est partagé avec votre agent.',
  pairAccountCta: 'Choisir un compte Google',
  pairSignedInAs: 'Connecté en tant que',
  pairSwitchAccount: 'Utiliser un autre compte',
  pairHomesTitle: 'Quelle maison votre agent doit-il gérer ?',
  pairHomesEmpty: 'Ce compte n’administre encore aucune maison. Créez-la ci-dessous.',
  pairHomesError: 'Impossible de charger vos maisons.',
  pairRetry: 'Réessayer',
  pairCreateToggle: 'Créer une nouvelle maison',
  pairCreateName: 'Nom de la maison',
  pairCreateId: 'Identifiant (définitif)',
  pairCreateIdHint: 'Lettres minuscules, chiffres et tirets. Il ne pourra plus changer.',
  pairCreateRelay: 'Relais (wss://…/ws)',
  pairCreateAdvanced: 'Options avancées',
  pairCreateSubmit: 'Créer la maison',
  pairContinue: 'Continuer',
  pairConfirmTitle: 'Accès complet à « {home} »',
  pairConfirmIntro: 'Avec ce code, votre agent recevra sa propre clé pour cette maison. Elle lui permettra de :',
  pairGrantCoordinator: 'faire fonctionner la maison : publier ses états et recevoir les actions demandées ;',
  pairGrantCli: 'lire les états et appeler les fonctions de la maison, y compris celles qui pilotent des appareils ;',
  pairGrantPush: 'envoyer des notifications aux personnes qui les ont autorisées pour cette maison ;',
  pairGrantComponents: 'publier et activer l’interface des habitants.',
  pairDenyTitle: 'Elle ne lui permettra pas de :',
  pairDenyBody:
    'gérer les clés, changer le relais, renommer ou supprimer la maison, ni accéder à vos autres '
    + 'maisons ou à votre compte Google.',
  pairConfirmCheck: 'Je donne à mon agent un accès complet à « {home} ».',
  pairConfirmSubmit: 'Générer le code d’appairage',
  pairBack: '← Changer de maison',
  pairCodeTitle: 'Transmettez ce code à votre agent.',
  pairCodeBody:
    'Copiez le message ci-dessous dans votre conversation avec l’agent. Il échangera ce code une seule '
    + 'fois contre sa propre clé avec la CLI Miakapp. Ne le donnez à personne d’autre.',
  pairCommandLabel: 'Commande que l’agent exécute',
  pairAgentMessage:
    'Appaire-toi à ma maison Miakapp « {home} ». Si la CLI n’est pas installée : `npm i -g @miakapp/cli`. '
    + 'Lance `{command}` et donne-lui le code d’appairage sur l’entrée standard (saisie masquée ou tube), '
    + 'jamais en argument de commande. Code (valable 10 minutes, une seule fois) : {code}',
  pairCopyMessage: 'Copier le message pour l’agent',
  pairCopyCode: 'Copier le code seul',
  pairCodeCopy: 'Copier le code',
  pairCodeCopied: 'Code copié',
  pairCodeExpiresIn: 'Expire dans {time}',
  pairCodeExpired: 'Ce code a expiré. Générez-en un nouveau.',
  pairCodeAgain: 'Générer un nouveau code',
  pairKeysTitle: 'Clés ayant accès à cette maison',
  pairKeysEmpty: 'Aucune clé active.',
  pairKeysCreated: 'créée le {date}',
  pairKeysLastUsed: 'dernière utilisation le {date}',
  pairKeysNeverUsed: 'jamais utilisée',
  pairKeysRevoke: 'Révoquer',
  pairKeysRevoked: 'Clé révoquée. Ses accès en cours expirent sous cinq minutes.',
  pairErrorStale: 'Pour votre sécurité, confirmez à nouveau votre identité.',
  pairErrorStaleCta: 'Confirmer mon identité',
  pairErrorNotAdmin: 'Ce compte n’administre pas cette maison. Choisissez un autre compte.',
  pairErrorHomeExists: 'Cet identifiant est déjà pris. Choisissez-en un autre.',
  pairErrorHomeLimit: 'Limite atteinte pour ce compte.',
  pairErrorRateLimited: 'Trop de tentatives. Patientez quelques minutes.',
  pairErrorInvalid: 'Vérifiez les informations saisies.',
  pairErrorUnavailable: 'Service momentanément indisponible. Réessayez.',
  pairErrorSignedOut: 'Votre session a pris fin. Reconnectez-vous.',
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
  onboardingAgentPrompt:
    'Install the `miakapp` CLI with `npm i -g @miakapp/cli`, then run `miakapp docs start` to begin.',

  pairKicker: 'Pair an agent',
  pairTitle: 'Give your agent access to your home.',
  pairLede:
    'Do it here, in your own browser: choose your account and the home, confirm, then hand '
    + 'the code to your agent. It never sees your account.',
  pairUnavailableTitle: 'Pairing is not available here.',
  pairUnavailableBody:
    'This preview is not connected to any Miakapp service. Open the pairing link your agent '
    + 'gave you on the Miakapp site.',
  pairLoading: 'Loading…',
  pairStepAccount: 'Account',
  pairStepHome: 'Home',
  pairStepConfirm: 'Confirm',
  pairStepCode: 'Pairing code',
  pairAccountTitle: 'Choose the account that administers the home.',
  pairAccountBody: 'Google will let you pick the account. Nothing is shared with your agent.',
  pairAccountCta: 'Choose a Google account',
  pairSignedInAs: 'Signed in as',
  pairSwitchAccount: 'Use another account',
  pairHomesTitle: 'Which home should your agent manage?',
  pairHomesEmpty: 'This account does not administer any home yet. Create it below.',
  pairHomesError: 'Your homes could not be loaded.',
  pairRetry: 'Try again',
  pairCreateToggle: 'Create a new home',
  pairCreateName: 'Home name',
  pairCreateId: 'Identifier (permanent)',
  pairCreateIdHint: 'Lowercase letters, digits and hyphens. It cannot change later.',
  pairCreateRelay: 'Relay (wss://…/ws)',
  pairCreateAdvanced: 'Advanced options',
  pairCreateSubmit: 'Create the home',
  pairContinue: 'Continue',
  pairConfirmTitle: 'Full access to “{home}”',
  pairConfirmIntro: 'With this code, your agent receives its own key for this home. It will be able to:',
  pairGrantCoordinator: 'run the home: publish its states and receive the actions people ask for;',
  pairGrantCli: 'read states and call the home’s functions, including those that control devices;',
  pairGrantPush: 'send notifications to people who allowed them for this home;',
  pairGrantComponents: 'publish and activate the residents’ interface.',
  pairDenyTitle: 'It will not be able to:',
  pairDenyBody:
    'manage keys, change the relay, rename or delete the home, or reach your other homes or '
    + 'your Google account.',
  pairConfirmCheck: 'I give my agent full access to “{home}”.',
  pairConfirmSubmit: 'Generate the pairing code',
  pairBack: '← Choose another home',
  pairCodeTitle: 'Hand this code to your agent.',
  pairCodeBody:
    'Copy the message below into your conversation with the agent. It exchanges this code once for '
    + 'its own key with the Miakapp CLI. Do not give it to anyone else.',
  pairCommandLabel: 'Command the agent runs',
  pairAgentMessage:
    'Pair with my Miakapp home “{home}”. If the CLI is missing: `npm i -g @miakapp/cli`. '
    + 'Run `{command}` and give it the pairing code on standard input (hidden prompt or pipe), '
    + 'never as a command argument. Code (valid 10 minutes, single use): {code}',
  pairCopyMessage: 'Copy the message for the agent',
  pairCopyCode: 'Copy the code only',
  pairCodeCopy: 'Copy the code',
  pairCodeCopied: 'Code copied',
  pairCodeExpiresIn: 'Expires in {time}',
  pairCodeExpired: 'This code has expired. Generate a new one.',
  pairCodeAgain: 'Generate a new code',
  pairKeysTitle: 'Keys with access to this home',
  pairKeysEmpty: 'No active key.',
  pairKeysCreated: 'created {date}',
  pairKeysLastUsed: 'last used {date}',
  pairKeysNeverUsed: 'never used',
  pairKeysRevoke: 'Revoke',
  pairKeysRevoked: 'Key revoked. Its current sessions expire within five minutes.',
  pairErrorStale: 'For your security, confirm your identity again.',
  pairErrorStaleCta: 'Confirm my identity',
  pairErrorNotAdmin: 'This account does not administer this home. Choose another account.',
  pairErrorHomeExists: 'This identifier is taken. Choose another one.',
  pairErrorHomeLimit: 'This account has reached its limit.',
  pairErrorRateLimited: 'Too many attempts. Wait a few minutes.',
  pairErrorInvalid: 'Check the information you entered.',
  pairErrorUnavailable: 'Service temporarily unavailable. Try again.',
  pairErrorSignedOut: 'Your session ended. Sign in again.',
};

export const COPY: Record<Locale, Record<CopyKey, string>> = { fr: FR, en: EN };

/** The prompt shown and copied is the visitor's language, never a fixed one. */
export function agentStartPrompt(locale: Locale): string {
  return COPY[locale].onboardingAgentPrompt;
}

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
