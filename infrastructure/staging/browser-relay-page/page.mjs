import { deleteApp, initializeApp } from 'firebase/app';
import {
  inMemoryPersistence,
  initializeAuth,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';

import {
  createBrowserClient,
  createControlPlaneBrowserRelayCredentialProvider,
} from './vendor/miakapi-browser-v4.mjs';
import { createBrowserRelayPageHost } from './runtime.mjs';

const firebaseConfig = __MIAKAPP_FIREBASE_CONFIG__;
const recaptchaSiteKey = __MIAKAPP_RECAPTCHA_SITE_KEY__;
const status = document.querySelector('[data-mia-state]');

function setState(value) {
  if (!(status instanceof HTMLElement)) return;
  status.dataset.miaState = value;
  status.textContent = `Staging browser relay acceptance: ${value}`;
}

async function createFirebaseSession(customToken, browser) {
  const app = initializeApp(firebaseConfig, `miakapp-browser-relay-${browser}`);
  let auth;
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    const credential = await signInWithCustomToken(auth, customToken);
    const user = credential.user;
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: false,
    });
    return Object.freeze({
      async getFirebaseIdToken(signal) {
        if (signal.aborted) throw signal.reason;
        return user.getIdToken(false);
      },
      async getAppCheckToken(signal) {
        if (signal.aborted) throw signal.reason;
        const result = await getToken(appCheck, true);
        if (signal.aborted) throw signal.reason;
        return result.token;
      },
      signOut: () => signOut(auth),
      dispose: () => deleteApp(app),
    });
  } catch {
    await deleteApp(app).catch(() => {});
    throw new Error('Firebase session initialization failed');
  }
}

const host = createBrowserRelayPageHost({
  createBrowserClient,
  createCredentialProvider: createControlPlaneBrowserRelayCredentialProvider,
  createFirebaseSession,
  fetch: globalThis.fetch.bind(globalThis),
  global: globalThis,
  now: () => performance.now(),
});

const api = Object.freeze({
  async initialize(input) {
    const result = await host.initialize(input);
    setState(result.state);
    return result;
  },
  async start() {
    const result = await host.start();
    setState(result.state);
    return result;
  },
  observe: () => host.observe(),
  observeState: (expected) => host.observeState(expected),
  call: (target) => host.call(target),
  async suspend() {
    const result = await host.suspend();
    setState(result.state);
    return result;
  },
  async resume() {
    const result = await host.resume();
    setState(result.state);
    return result;
  },
  async stop() {
    const result = await host.stop();
    setState(result.state);
    return result;
  },
});

Object.defineProperty(globalThis, 'miakappBrowserRelayPage', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: api,
});
