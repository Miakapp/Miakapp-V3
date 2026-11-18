/**
 * The words of the trusted house shell — the Miakapp layer that stays around a
 * home's own interface. Kept apart from `copy.ts`, which is the public site's,
 * but built the same way: French defines the key set and English must answer
 * every key or the build fails.
 *
 * Nothing here is ever filled with text a home wrote. Placeholders take only
 * the home's name, which comes from Miakapp, not from the home's interface.
 */

import type { HouseAppFailureCode } from '../../component-runtime/src/app-host';
import type { Locale } from './copy';

const FR = {
  menuLabel: 'Menu Miakapp',
  barLabel: 'Miakapp',
  profile: 'Moi',
  profileTitle: 'Moi',
  homeSettings: 'Gérer cette maison',
  signInMethods: 'Connexion avec',
  signInMethodEmail: 'lien par e-mail',
  switchHome: 'Changer de maison',
  homesTitle: 'Mes maisons',
  homesCurrent: 'Ouverte',
  homesOpen: 'Ouvrir {home}',
  homesEmpty: 'Les maisons que vous ouvrez s’ajoutent ici, sur tous vos appareils. L’étoile les retire ou les remet.',
  openHomeLabel: 'Ouvrir une autre maison avec son identifiant ou son lien.',
  welcomeTitle: 'Bienvenue sur Miakapp',
  welcomeLede: 'Ouvrez la maison où l’on vous attend : son identifiant ou son lien vous a été donné par ses habitants.',
  welcomeCreate: 'Pas encore de maison ?',
  welcomeCreateLink: 'Créer la vôtre',
  openHomePlaceholder: 'ma-maison ou miakapp.com/h/ma-maison',
  openHomeSubmit: 'Ouvrir',
  openHomeInvalid: 'Ce n’est pas un identifiant de maison. Exemple : ma-maison.',
  favoriteAdd: 'Garder {home} dans mes maisons',
  favoriteRemove: 'Retirer {home} de mes maisons',
  settings: 'Réglages',
  settingsTitle: 'Réglages',
  accountSection: 'Compte',
  signOut: 'Se déconnecter',
  signingOut: 'Déconnexion…',
  signOutFailed: 'La déconnexion a échoué. Réessayez.',
  close: 'Fermer',
  consentSection: 'Cette maison',
  consentGrantedOn: 'Vous avez accepté d’ouvrir son interface le {date}.',
  consentRevoke: 'Retirer mon accord',
  reload: 'Relancer l’interface',
  shortcutHint: 'Depuis la maison, Alt + Maj + M ramène à la barre Miakapp.',

  connectionRetry: 'Réessayer',
  connectionRetryLabel: 'Réessayer la connexion',
  connectionOffline: 'Maison hors ligne',
  connectionReconnecting: 'Reconnexion…',
  connectionConnecting: 'Connexion…',

  consentKicker: 'Première visite',
  consentTitle: 'Ouvrir {home} ?',
  consentLede: 'L’interface de cette maison est créée et gérée par la personne qui s’en occupe, pas par Miakapp.',
  consentPointOwner: 'Son contenu, son apparence et ses commandes dépendent du propriétaire de la maison.',
  consentPointIsolation: 'Elle s’ouvre dans un espace isolé : elle ne voit ni votre compte, ni vos autres maisons.',
  consentPointMenu: 'La barre Miakapp reste toujours accessible en bas de l’écran.',
  consentFoot: 'Rien de cette maison n’est chargé avant votre accord. Vous pourrez le retirer dans les réglages.',
  consentAccept: 'Ouvrir la maison',
  consentDecline: 'Pas maintenant',

  declinedTitle: '{home} n’a pas été ouverte',
  declinedLede: 'Aucun contenu de cette maison n’a été chargé.',
  declinedReopen: 'Ouvrir quand même',
  declinedOther: 'Vos autres maisons',

  languageSection: 'Langue',
  pushSection: 'Notifications',
  pushEnable: 'Activer les notifications sur cet appareil',
  pushEnabling: 'Activation…',
  pushEnabled: 'Notifications activées sur cet appareil.',
  pushDenied: 'Les notifications sont bloquées pour Miakapp. Autorisez-les dans les réglages de l’appareil, puis réessayez.',
  pushNoTestPush: 'La notification de test n’est pas arrivée. Vérifiez votre connexion, puis réessayez.',
  pushTooMany: 'Trop d’essais en peu de temps. Réessayez dans 5 minutes.',
  pushFailed: 'Impossible d’activer les notifications. Sur iPhone, ouvrez Miakapp depuis l’icône de l’écran d’accueil.',
  signInTitle: 'Connectez-vous pour ouvrir {home}',
  signInLede: 'Votre compte permet à Miakapp de vérifier que cette maison vous est ouverte.',
  signInAction: 'Se connecter avec Google',
  signingIn: 'Connexion…',
  signInFailed: 'La connexion n’a pas abouti. Réessayez.',

  emptyTitle: '{home} n’a pas encore d’interface',
  emptyLede: 'Rien n’a encore été publié pour cette maison. Demandez à votre agent d’en créer une : dès qu’il la publie, elle s’affiche ici.',

  loading: 'Ouverture de {home}…',
  frameTitle: 'Interface de {home}',

  crashTitle: '{home} s’est arrêtée',
  crashRetry: 'Relancer',
  unavailableTitle: 'Impossible d’ouvrir {home} pour l’instant',
  unavailableLede: 'Miakapp n’arrive pas à récupérer l’interface. Vérifiez votre connexion internet, puis réessayez dans un instant.',

  failure_abi_mismatch: 'Cette interface a été publiée pour une autre version de Miakapp. Votre agent peut la republier avec la CLI à jour.',
  failure_sandbox_origin_invalid: 'Un réglage de Miakapp empêche d’ouvrir l’interface. Ce n’est pas de votre faute : réessayez plus tard.',
  failure_sandbox_unreachable: 'Miakapp n’arrive pas à préparer l’espace où s’affiche l’interface. Vérifiez votre connexion, puis relancez.',
  failure_boot_timeout: 'L’interface a mis trop de temps à démarrer. Relancez ; si ça recommence, votre agent peut l’alléger ou la corriger.',
  failure_artifact_integrity: 'Le fichier reçu ne correspond pas à la version publiée, il n’a donc pas été lancé. Relancez ; si ça recommence, demandez à votre agent de republier.',
  failure_artifact_load: 'L’interface n’a pas pu être téléchargée. Vérifiez votre connexion, puis relancez.',
  failure_boot_error: 'L’interface a planté au démarrage. Votre agent peut la corriger et la republier.',
  failure_unresponsive: 'L’interface ne répondait plus. Relancez ; si ça recommence, votre agent peut la corriger.',
  failure_navigated: 'L’interface a essayé d’ouvrir une autre page, ce qui n’est pas autorisé. Votre agent peut la corriger.',
  failure_protocol_violation: 'L’interface a fait une demande que Miakapp ne permet pas. Votre agent peut la corriger.',
};

export type HouseCopyKey = keyof typeof FR;

const EN: Record<HouseCopyKey, string> = {
  menuLabel: 'Miakapp menu',
  barLabel: 'Miakapp',
  profile: 'Me',
  profileTitle: 'Me',
  homeSettings: 'Manage this home',
  signInMethods: 'Signs in with',
  signInMethodEmail: 'emailed link',
  switchHome: 'Switch home',
  homesTitle: 'My homes',
  homesCurrent: 'Open',
  homesOpen: 'Open {home}',
  homesEmpty: 'Homes you open are added here, on all your devices. The star removes or keeps them.',
  openHomeLabel: 'Open another home with its id or link.',
  welcomeTitle: 'Welcome to Miakapp',
  welcomeLede: 'Open the home you were invited to: its residents gave you its id or link.',
  welcomeCreate: 'No home yet?',
  welcomeCreateLink: 'Create yours',
  openHomePlaceholder: 'ma-maison or miakapp.com/h/ma-maison',
  openHomeSubmit: 'Open',
  openHomeInvalid: 'That is not a home id. Example: ma-maison.',
  favoriteAdd: 'Keep {home} in my homes',
  favoriteRemove: 'Remove {home} from my homes',
  settings: 'Settings',
  settingsTitle: 'Settings',
  accountSection: 'Account',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  signOutFailed: 'Sign-out failed. Try again.',
  close: 'Close',
  consentSection: 'This home',
  consentGrantedOn: 'You agreed to open its interface on {date}.',
  consentRevoke: 'Withdraw my agreement',
  reload: 'Restart the interface',
  shortcutHint: 'From inside the home, Alt + Shift + M brings you back to the Miakapp bar.',

  connectionRetry: 'Retry',
  connectionRetryLabel: 'Retry connection',
  connectionOffline: 'Home offline',
  connectionReconnecting: 'Reconnecting…',
  connectionConnecting: 'Connecting…',

  consentKicker: 'First visit',
  consentTitle: 'Open {home}?',
  consentLede: 'This home’s interface is made and run by whoever looks after the home, not by Miakapp.',
  consentPointOwner: 'What it shows, how it looks and what it controls are up to the home’s owner.',
  consentPointIsolation: 'It opens in an isolated space: it cannot see your account or your other homes.',
  consentPointMenu: 'The Miakapp bar always stays available at the bottom of the screen.',
  consentFoot: 'Nothing from this home loads before you agree. You can withdraw it in settings.',
  consentAccept: 'Open the home',
  consentDecline: 'Not now',

  declinedTitle: '{home} was not opened',
  declinedLede: 'Nothing from this home was loaded.',
  declinedReopen: 'Open it anyway',
  declinedOther: 'Your other homes',

  languageSection: 'Language',
  pushSection: 'Notifications',
  pushEnable: 'Turn on notifications on this device',
  pushEnabling: 'Turning on…',
  pushEnabled: 'Notifications are on for this device.',
  pushDenied: 'Notifications are blocked for Miakapp. Allow them in the device settings, then try again.',
  pushNoTestPush: 'The test notification did not arrive. Check your connection, then try again.',
  pushTooMany: 'Too many attempts in a short time. Try again in 5 minutes.',
  pushFailed: 'Notifications could not be turned on. On iPhone, open Miakapp from its Home Screen icon.',
  signInTitle: 'Sign in to open {home}',
  signInLede: 'Your account lets Miakapp check that this home is open to you.',
  signInAction: 'Sign in with Google',
  signingIn: 'Signing in…',
  signInFailed: 'Sign-in did not complete. Try again.',

  emptyTitle: '{home} has no interface yet',
  emptyLede: 'Nothing has been published for this home yet. Ask your agent to build one: as soon as it publishes, it shows up here.',

  loading: 'Opening {home}…',
  frameTitle: '{home} interface',

  crashTitle: '{home} stopped',
  crashRetry: 'Restart',
  unavailableTitle: '{home} can’t be opened right now',
  unavailableLede: 'Miakapp can’t fetch the interface. Check your internet connection, then try again in a moment.',

  failure_abi_mismatch: 'This interface was published for another version of Miakapp. Your agent can republish it with the current CLI.',
  failure_sandbox_origin_invalid: 'A Miakapp setting prevents opening the interface. It is not on your side: try again later.',
  failure_sandbox_unreachable: 'Miakapp can’t prepare the space the interface runs in. Check your connection, then restart it.',
  failure_boot_timeout: 'The interface took too long to start. Restart it; if it happens again, your agent can lighten or fix it.',
  failure_artifact_integrity: 'The file received does not match the published version, so it was not run. Restart; if it happens again, ask your agent to republish.',
  failure_artifact_load: 'The interface could not be downloaded. Check your connection, then restart it.',
  failure_boot_error: 'The interface crashed while starting. Your agent can fix and republish it.',
  failure_unresponsive: 'The interface stopped responding. Restart it; if it happens again, your agent can fix it.',
  failure_navigated: 'The interface tried to open another page, which is not allowed. Your agent can fix it.',
  failure_protocol_violation: 'The interface made a request Miakapp does not allow. Your agent can fix it.',
};

export const HOUSE_COPY: Record<Locale, Record<HouseCopyKey, string>> = { fr: FR, en: EN };

export type HouseTranslate = (key: HouseCopyKey, values?: Readonly<Record<string, string>>) => string;

export function houseTranslator(locale: Locale): HouseTranslate {
  return (key, values) => HOUSE_COPY[locale][key].replace(
    /\{(\w+)\}/gu,
    (match, name: string) => values?.[name] ?? match,
  );
}

export function failureKey(code: HouseAppFailureCode): HouseCopyKey {
  return `failure_${code}`;
}
