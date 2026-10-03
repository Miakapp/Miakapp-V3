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
  switchHome: 'Changer de maison',
  homesTitle: 'Maisons',
  homesCurrent: 'Ouverte',
  homesOpen: 'Ouvrir {home}',
  homesEmpty: 'Ajoutez une maison aux favoris avec l’étoile pour la retrouver ici.',
  favoriteAdd: 'Ajouter {home} aux favoris',
  favoriteRemove: 'Retirer {home} des favoris',
  settings: 'Réglages',
  settingsTitle: 'Réglages',
  accountSection: 'Compte',
  signOut: 'Se déconnecter',
  signingOut: 'Déconnexion…',
  signOutFailed: 'La déconnexion a échoué. Réessayez.',
  close: 'Fermer',
  themeLabel: 'Apparence de la maison',
  themeSystem: 'Système',
  themeLight: 'Clair',
  themeDark: 'Sombre',
  consentSection: 'Cette maison',
  consentGrantedOn: 'Vous avez accepté d’ouvrir son interface le {date}.',
  consentRevoke: 'Retirer mon accord',
  reload: 'Relancer l’interface',
  shortcutHint: 'Depuis la maison, Alt + Maj + M ramène au menu Miakapp.',

  connectionOffline: 'Maison hors ligne',
  connectionReconnecting: 'Reconnexion…',
  connectionConnecting: 'Connexion…',

  consentKicker: 'Première visite',
  consentTitle: 'Ouvrir {home} ?',
  consentLede: 'L’interface de cette maison est créée et gérée par la personne qui s’en occupe, pas par Miakapp.',
  consentPointOwner: 'Son contenu, son apparence et ses commandes dépendent du propriétaire de la maison.',
  consentPointIsolation: 'Elle s’ouvre dans un espace isolé : elle ne voit ni votre compte, ni vos autres maisons.',
  consentPointMenu: 'Ce menu Miakapp reste toujours accessible en haut de l’écran.',
  consentFoot: 'Rien de cette maison n’est chargé avant votre accord. Vous pourrez le retirer dans les réglages.',
  consentAccept: 'Ouvrir la maison',
  consentDecline: 'Pas maintenant',

  declinedTitle: '{home} n’a pas été ouverte',
  declinedLede: 'Aucun contenu de cette maison n’a été chargé.',
  declinedReopen: 'Ouvrir quand même',
  declinedOther: 'Vos autres maisons',

  signInTitle: 'Connectez-vous pour ouvrir {home}',
  signInLede: 'Votre compte permet à Miakapp de vérifier que cette maison vous est ouverte.',
  signInAction: 'Se connecter avec Google',

  emptyTitle: '{home} n’a pas encore d’interface',
  emptyLede: 'La personne qui s’occupe de cette maison ne l’a pas encore publiée.',

  loading: 'Ouverture de {home}…',
  frameTitle: 'Interface de {home}',

  crashTitle: 'L’interface de {home} s’est arrêtée',
  crashRetry: 'Relancer',
  unavailableTitle: 'L’interface de {home} n’est pas disponible',
  unavailableLede: 'Elle n’a pas pu être récupérée. Vérifiez votre connexion puis réessayez.',

  failure_abi_mismatch: 'Cette version de l’interface n’est pas prise en charge.',
  failure_sandbox_origin_invalid: 'L’espace isolé de Miakapp est mal configuré ; rien n’a été ouvert.',
  failure_sandbox_unreachable: 'L’espace isolé de Miakapp est injoignable pour le moment.',
  failure_boot_timeout: 'Elle a mis trop de temps à démarrer.',
  failure_artifact_integrity: 'Le fichier reçu ne correspond pas à la version publiée ; il n’a pas été exécuté.',
  failure_artifact_load: 'Elle n’a pas pu démarrer.',
  failure_boot_error: 'Elle a rencontré une erreur au démarrage.',
  failure_unresponsive: 'Elle ne répondait plus.',
  failure_navigated: 'Elle a tenté d’afficher une page non vérifiée.',
  failure_protocol_violation: 'Elle a envoyé une demande non autorisée.',
};

export type HouseCopyKey = keyof typeof FR;

const EN: Record<HouseCopyKey, string> = {
  menuLabel: 'Miakapp menu',
  barLabel: 'Miakapp',
  switchHome: 'Switch home',
  homesTitle: 'Homes',
  homesCurrent: 'Open',
  homesOpen: 'Open {home}',
  homesEmpty: 'Star a home to keep it here.',
  favoriteAdd: 'Add {home} to favorites',
  favoriteRemove: 'Remove {home} from favorites',
  settings: 'Settings',
  settingsTitle: 'Settings',
  accountSection: 'Account',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  signOutFailed: 'Sign-out failed. Try again.',
  close: 'Close',
  themeLabel: 'Home appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  consentSection: 'This home',
  consentGrantedOn: 'You agreed to open its interface on {date}.',
  consentRevoke: 'Withdraw my agreement',
  reload: 'Restart the interface',
  shortcutHint: 'From inside the home, Alt + Shift + M brings you back to the Miakapp menu.',

  connectionOffline: 'Home offline',
  connectionReconnecting: 'Reconnecting…',
  connectionConnecting: 'Connecting…',

  consentKicker: 'First visit',
  consentTitle: 'Open {home}?',
  consentLede: 'This home’s interface is made and run by whoever looks after the home, not by Miakapp.',
  consentPointOwner: 'What it shows, how it looks and what it controls are up to the home’s owner.',
  consentPointIsolation: 'It opens in an isolated space: it cannot see your account or your other homes.',
  consentPointMenu: 'This Miakapp menu always stays available at the top of the screen.',
  consentFoot: 'Nothing from this home loads before you agree. You can withdraw it in settings.',
  consentAccept: 'Open the home',
  consentDecline: 'Not now',

  declinedTitle: '{home} was not opened',
  declinedLede: 'Nothing from this home was loaded.',
  declinedReopen: 'Open it anyway',
  declinedOther: 'Your other homes',

  signInTitle: 'Sign in to open {home}',
  signInLede: 'Your account lets Miakapp check that this home is open to you.',
  signInAction: 'Sign in with Google',

  emptyTitle: '{home} has no interface yet',
  emptyLede: 'Whoever looks after this home has not published one yet.',

  loading: 'Opening {home}…',
  frameTitle: '{home} interface',

  crashTitle: '{home}’s interface stopped',
  crashRetry: 'Restart',
  unavailableTitle: '{home}’s interface is unavailable',
  unavailableLede: 'It could not be retrieved. Check your connection and try again.',

  failure_abi_mismatch: 'This version of the interface is not supported.',
  failure_sandbox_origin_invalid: 'Miakapp’s isolated space is misconfigured; nothing was opened.',
  failure_sandbox_unreachable: 'Miakapp’s isolated space cannot be reached right now.',
  failure_boot_timeout: 'It took too long to start.',
  failure_artifact_integrity: 'The file received does not match the published version; it was not run.',
  failure_artifact_load: 'It could not start.',
  failure_boot_error: 'It hit an error while starting.',
  failure_unresponsive: 'It stopped responding.',
  failure_navigated: 'It tried to show a page that was not verified.',
  failure_protocol_violation: 'It sent a request it is not allowed to make.',
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
