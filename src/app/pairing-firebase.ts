import { onAuthStateChanged, signOut, type Auth } from 'firebase/auth';

import {
  createPairingApi,
  type NewPairingHome,
  type PairingAccount,
  type PairingApi,
  type PairingService,
} from './pairing-client';
import { signInWith, type SignInMethod, type SignInOutcome } from './sign-in';

type SignIn = (auth: Auth, method: SignInMethod) => Promise<SignInOutcome>;

export interface FirebasePairingOptions {
  readonly auth: Auth;
  readonly controlPlaneOrigin: string;
  readonly defaultRelayUrl: string | undefined;
  readonly signInWith?: SignIn;
  readonly fetch?: typeof fetch;
}

/**
 * Pairing signs in through the person's own browser and always shows the provider's
 * account chooser: the account that pairs is the one they pick, never one a
 * previous session happened to leave behind. A fresh sign-in also renews the
 * ten-minute recent-authentication window the control plane requires before it
 * creates a home or issues a code.
 */
function signInMethodName(providerId: string): string {
  if (providerId === 'google.com') return 'google';
  if (providerId === 'github.com') return 'github';
  if (providerId === 'password' || providerId === 'emailLink') return 'email';
  return providerId;
}

export class FirebasePairingService implements PairingService {
  readonly defaultRelayUrl: string | undefined;
  readonly issuer: string;
  readonly #auth: Auth;
  readonly #api: PairingApi;
  readonly #listeners = new Set<() => void>();
  readonly #signInWith: SignIn;
  readonly #removeAuthListener: () => void;
  #account: PairingAccount | null | undefined = undefined;

  constructor(options: FirebasePairingOptions) {
    this.#auth = options.auth;
    this.defaultRelayUrl = options.defaultRelayUrl;
    this.issuer = options.controlPlaneOrigin.replace(/\/+$/u, '');
    this.#signInWith = options.signInWith ?? signInWith;
    this.#api = createPairingApi({
      controlPlaneOrigin: options.controlPlaneOrigin,
      fetch: options.fetch,
      getIdToken: async () => (await this.#auth.currentUser?.getIdToken()) ?? null,
    });
    this.#removeAuthListener = onAuthStateChanged(this.#auth, (user) => {
      this.#account = user === null
        ? null
        : Object.freeze({
          id: user.uid,
          email: user.email,
          name: user.displayName,
          methods: Object.freeze(user.providerData.map((entry) => signInMethodName(entry.providerId))),
        });
      for (const listener of this.#listeners) listener();
    });
  }

  readonly getAccount = (): PairingAccount | null | undefined => this.#account;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly signIn = async (method?: SignInMethod): Promise<SignInOutcome> =>
    await this.#signInWith(this.#auth, method ?? this.#currentMethod());

  #currentMethod(): SignInMethod {
    const user = this.#auth.currentUser;
    const provider = user?.providerData[0]?.providerId;
    if (provider === 'github.com') return { kind: 'github' };
    if (provider === 'password' || provider === 'emailLink') return { kind: 'email', email: user!.email! };
    return { kind: 'google' };
  }

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
