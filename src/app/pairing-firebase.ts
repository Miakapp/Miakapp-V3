import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';

import {
  createPairingApi,
  type NewPairingHome,
  type PairingAccount,
  type PairingApi,
  type PairingService,
} from './pairing-client';

type PopupSignIn = (auth: Auth, provider: GoogleAuthProvider) => Promise<unknown>;

export interface FirebasePairingOptions {
  readonly auth: Auth;
  readonly controlPlaneOrigin: string;
  readonly defaultRelayUrl: string | undefined;
  readonly popupSignIn?: PopupSignIn;
  readonly fetch?: typeof fetch;
}

/**
 * Pairing signs in through the person's own browser and always shows Google's
 * account chooser: the account that pairs is the one they pick, never one a
 * previous session happened to leave behind. A fresh sign-in also renews the
 * ten-minute recent-authentication window the control plane requires before it
 * creates a home or issues a code.
 */
export class FirebasePairingService implements PairingService {
  readonly defaultRelayUrl: string | undefined;
  readonly issuer: string;
  readonly #auth: Auth;
  readonly #api: PairingApi;
  readonly #listeners = new Set<() => void>();
  readonly #popupSignIn: PopupSignIn;
  readonly #removeAuthListener: () => void;
  #account: PairingAccount | null | undefined = undefined;

  constructor(options: FirebasePairingOptions) {
    this.#auth = options.auth;
    this.defaultRelayUrl = options.defaultRelayUrl;
    this.issuer = options.controlPlaneOrigin.replace(/\/+$/u, '');
    this.#popupSignIn = options.popupSignIn ?? signInWithPopup;
    this.#api = createPairingApi({
      controlPlaneOrigin: options.controlPlaneOrigin,
      fetch: options.fetch,
      getIdToken: async () => (await this.#auth.currentUser?.getIdToken()) ?? null,
    });
    this.#removeAuthListener = onAuthStateChanged(this.#auth, (user) => {
      this.#account = user === null
        ? null
        : Object.freeze({ id: user.uid, email: user.email, name: user.displayName });
      for (const listener of this.#listeners) listener();
    });
  }

  readonly getAccount = (): PairingAccount | null | undefined => this.#account;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly signIn = async (): Promise<void> => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await this.#popupSignIn(this.#auth, provider);
  };

  readonly signOut = async (): Promise<void> => {
    await signOut(this.#auth);
  };

  readonly listHomes = (): ReturnType<PairingApi['listHomes']> => this.#api.listHomes();

  readonly createHome = (input: NewPairingHome): ReturnType<PairingApi['createHome']> => (
    this.#api.createHome(input)
  );

  readonly issueCode = (homeId: string): ReturnType<PairingApi['issueCode']> => this.#api.issueCode(homeId);

  readonly listKeys = (homeId: string): ReturnType<PairingApi['listKeys']> => this.#api.listKeys(homeId);

  readonly revokeKey = (homeId: string, keyId: string): ReturnType<PairingApi['revokeKey']> => (
    this.#api.revokeKey(homeId, keyId)
  );

  readonly dispose = (): void => {
    this.#removeAuthListener();
    this.#listeners.clear();
  };
}
