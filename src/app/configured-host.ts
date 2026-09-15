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

import {
  createComponentReleaseCoordinator,
  createControlPlanePointerReader,
  type ComponentReleaseCoordinator,
} from './component-release';
import { createDemoHost } from './demo-host';
import type { TrustedHost } from './host';
import { createLiveHost, type LiveIdentity } from './live-host';

interface ComponentReleaseConfiguration {
  readonly pointerEndpoint: string;
  readonly allowedArtifactOrigins: ReadonlySet<string>;
}

interface LiveConfiguration {
  readonly firebase: FirebaseOptions;
  readonly appCheckSiteKey: string;
  readonly exchangeEndpoint: string;
  readonly homeId: string;
  readonly homeName: string;
  readonly homeDetail: string;
  readonly componentRelease: ComponentReleaseConfiguration | undefined;
}

const LIVE_APP_NAME = 'miakapp-live-host';

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

function optional(name: string): string | undefined {
  const value = import.meta.env[name];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
}

/**
 * Component releases stay off until the deployment states both where the live
 * pointer is served and which origins may serve artifacts. Neither can be
 * guessed: they are the trust boundary the release ledger enforces.
 */
function readComponentReleaseConfiguration(): ComponentReleaseConfiguration | undefined {
  const pointerEndpoint = optional('VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT');
  const origins = optional('VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS');
  if (pointerEndpoint === undefined || origins === undefined) return undefined;
  if (!pointerEndpoint.startsWith('https://')) {
    throw new Error('The Miakapp component pointer endpoint must use HTTPS');
  }
  const allowedArtifactOrigins = new Set(
    origins.split(',').map((origin) => origin.trim()).filter((origin) => origin !== ''),
  );
  for (const origin of allowedArtifactOrigins) {
    if (!origin.startsWith('https://')) {
      throw new Error(`Component artifact origin ${origin} must use HTTPS`);
    }
  }
  if (allowedArtifactOrigins.size === 0) {
    throw new Error('VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS lists no origin');
  }
  return Object.freeze({ pointerEndpoint, allowedArtifactOrigins });
}

/**
 * The component runtime stays off until the deployment names the origin of the
 * dedicated sandbox site. That origin is the containment boundary, not a
 * convenience: deriving it from the shell's own origin would serve home-authored
 * code from the origin holding the session. It is declared or the runtime does
 * not mount.
 */
export function readConfiguredSandboxOrigin(): string | undefined {
  const origin = optional('VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN');
  if (origin === undefined) return undefined;
  if (!origin.startsWith('https://')) {
    throw new Error('The Miakapp component sandbox origin must use HTTPS');
  }
  return origin;
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
    componentRelease: readComponentReleaseConfiguration(),
  });
}

interface LiveRuntime {
  readonly auth: Auth;
  readonly appCheck: AppCheck;
}

const liveRuntimes = new WeakMap<object, LiveRuntime>();

/**
 * App Check may only be initialized once per Firebase app, so the host and the
 * component release coordinator share one runtime. They still build their own
 * identity, so disposing one never revokes the other's auth listener.
 */
function liveRuntime(configuration: LiveConfiguration): LiveRuntime {
  const app = getApps().find(({ name }) => name === LIVE_APP_NAME)
    ?? initializeApp(configuration.firebase, LIVE_APP_NAME);
  const existing = liveRuntimes.get(app);
  if (existing !== undefined) return existing;
  const runtime: LiveRuntime = Object.freeze({
    auth: getAuth(app),
    appCheck: initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(configuration.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    }),
  });
  liveRuntimes.set(app, runtime);
  return runtime;
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

/**
 * Builds the coordinator the shell calls at boot, or undefined when this build
 * serves the preview or declares no component release trust boundary.
 */
export function createConfiguredComponentRelease(): ComponentReleaseCoordinator | undefined {
  const configuration = readLiveConfiguration();
  if (configuration === undefined) return undefined;
  const release = configuration.componentRelease;
  if (release === undefined) return undefined;

  const { auth, appCheck } = liveRuntime(configuration);
  const identity = new FirebaseLiveIdentity(auth, appCheck);
  const homeId = configuration.homeId;
  const credentialRequest = (signal: AbortSignal | undefined) => Object.freeze({
    homeId,
    reason: 'initial' as const,
    signal: signal ?? new AbortController().signal,
  });

  return createComponentReleaseCoordinator({
    homeId,
    allowedArtifactOrigins: release.allowedArtifactOrigins,
    readPointer: createControlPlanePointerReader({
      endpoint: release.pointerEndpoint,
      homeId,
      authorize: async (signal) =>
        `Bearer ${await identity.getFirebaseIdToken(credentialRequest(signal))}`,
      appCheckToken: async (signal) => await identity.getAppCheckToken(credentialRequest(signal)),
    }),
  });
}

export function createConfiguredHost(): TrustedHost {
  const configuration = readLiveConfiguration();
  if (configuration === undefined) return createDemoHost();

  const { auth, appCheck } = liveRuntime(configuration);
  const identity = new FirebaseLiveIdentity(auth, appCheck);

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
