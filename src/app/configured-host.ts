import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

import { createDemoHost } from './demo-host';
import type { TrustedHost } from './host';
import { createLiveHost, type LiveIdentity } from './live-host';

interface LiveConfiguration {
  readonly firebase: FirebaseOptions;
  readonly appCheckSiteKey: string;
  readonly exchangeEndpoint: string;
  readonly homeId: string;
  readonly homeName: string;
  readonly homeDetail: string;
}

type GooglePopupSignIn = (
  auth: Auth,
  provider: GoogleAuthProvider,
) => Promise<unknown>;

export async function signInWithGoogle(
  auth: Auth,
  popupSignIn: GooglePopupSignIn = signInWithPopup,
): Promise<void> {
  await popupSignIn(auth, new GoogleAuthProvider());
}

function required(name: string): string {
  const value = import.meta.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${name} for the Miakapp live host`);
  }
  return value;
}

function readLiveConfiguration(): LiveConfiguration | undefined {
  if (import.meta.env.VITE_MIAKAPP_MODE !== 'live') return undefined;
  const exchangeEndpoint = required('VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT');
  if (!exchangeEndpoint.startsWith('https://')) {
    throw new Error('The Miakapp control-plane exchange endpoint must use HTTPS');
  }
  return Object.freeze({
    firebase: Object.freeze({
      apiKey: required('VITE_MIAKAPP_FIREBASE_API_KEY'),
      appId: required('VITE_MIAKAPP_FIREBASE_APP_ID'),
      authDomain: required('VITE_MIAKAPP_FIREBASE_AUTH_DOMAIN'),
      messagingSenderId: required('VITE_MIAKAPP_FIREBASE_MESSAGING_SENDER_ID'),
      projectId: required('VITE_MIAKAPP_FIREBASE_PROJECT_ID'),
      storageBucket: required('VITE_MIAKAPP_FIREBASE_STORAGE_BUCKET'),
    }),
    appCheckSiteKey: required('VITE_MIAKAPP_APP_CHECK_SITE_KEY'),
    exchangeEndpoint,
    homeId: required('VITE_MIAKAPP_HOME_ID'),
    homeName: required('VITE_MIAKAPP_HOME_NAME'),
    homeDetail: required('VITE_MIAKAPP_HOME_DETAIL'),
  });
}

class FirebaseLiveIdentity implements LiveIdentity {
  readonly #auth: Auth;
  readonly #appCheck: AppCheck;
  readonly #listeners = new Set<(signedIn: boolean) => void>();
  readonly #removeAuthListener: () => void;
  #signedIn: boolean;

  constructor(auth: Auth, appCheck: AppCheck) {
    this.#auth = auth;
    this.#appCheck = appCheck;
    this.#signedIn = auth.currentUser !== null;
    this.#removeAuthListener = onAuthStateChanged(auth, (user) => {
      const signedIn = user !== null;
      if (signedIn === this.#signedIn) return;
      this.#signedIn = signedIn;
      for (const listener of this.#listeners) listener(signedIn);
    });
  }

  readonly isSignedIn = (): boolean => this.#signedIn;

  readonly subscribe = (listener: (signedIn: boolean) => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly signIn = async (): Promise<void> => {
    await signInWithGoogle(this.#auth);
  };

  readonly getFirebaseIdToken: LiveIdentity['getFirebaseIdToken'] = async ({ signal }) => {
    if (signal.aborted) throw signal.reason;
    const user = this.#auth.currentUser;
    if (user === null) throw new Error('The Firebase user is signed out');
    const token = await user.getIdToken(false);
    if (signal.aborted) throw signal.reason;
    return token;
  };

  readonly getAppCheckToken: LiveIdentity['getAppCheckToken'] = async ({ signal }) => {
    if (signal.aborted) throw signal.reason;
    const token = await getToken(this.#appCheck, false);
    if (signal.aborted) throw signal.reason;
    return token.token;
  };

  readonly dispose = (): void => {
    this.#removeAuthListener();
    this.#listeners.clear();
  };
}

export function createConfiguredHost(): TrustedHost {
  const configuration = readLiveConfiguration();
  if (configuration === undefined) return createDemoHost();

  const app = getApps().find(({ name }) => name === 'miakapp-live-host')
    ?? initializeApp(configuration.firebase, 'miakapp-live-host');
  const identity = new FirebaseLiveIdentity(
    getAuth(app),
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(configuration.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    }),
  );

  return createLiveHost({
    exchangeEndpoint: configuration.exchangeEndpoint,
    home: Object.freeze({
      id: configuration.homeId,
      name: configuration.homeName,
      detail: configuration.homeDetail,
      accent: '#b8d9ff',
    }),
    identity,
  });
}
