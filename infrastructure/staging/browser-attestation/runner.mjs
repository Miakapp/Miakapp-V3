import { deleteApp, initializeApp } from 'firebase/app';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';

const firebaseConfig = __MIAKAPP_FIREBASE_CONFIG__;
const recaptchaSiteKey = __MIAKAPP_RECAPTCHA_SITE_KEY__;
const status = document.querySelector('[data-mia-state]');
const parameters = new URL(window.location.href).searchParams;
const challenge = parameters.get('challenge');
const callbackValue = parameters.get('callback');

function validatedCallback(value) {
  try {
    const callback = new URL(value);
    const port = Number(callback.port);
    if (callback.protocol !== 'http:'
      || callback.hostname !== '127.0.0.1'
      || callback.username !== ''
      || callback.password !== ''
      || !Number.isInteger(port) || port < 1024 || port > 65_535
      || !/^\/__miakapp\/app-check\/[0-9a-f]{64}$/u.test(callback.pathname)
      || callback.search !== ''
      || callback.hash !== '') return undefined;
    return callback;
  } catch {
    return undefined;
  }
}

const callback = validatedCallback(callbackValue);
const requestIsValid = JSON.stringify([...parameters.keys()].sort())
    === JSON.stringify(['callback', 'challenge'])
  && /^[0-9a-f]{64}$/u.test(challenge ?? '')
  && callback !== undefined;

function setState(value) {
  if (!(status instanceof HTMLElement)) return;
  status.dataset.miaState = value;
  status.textContent = {
    failed: 'Staging attestation failed',
    passed: 'Staging attestation passed',
    returning: 'Returning bounded staging evidence…',
  }[value] ?? 'Staging attestation failed';
}

async function attest() {
  const startedAt = performance.now();
  let app;
  try {
    if (!requestIsValid) throw new Error('closed-request-shape-rejected');
    app = initializeApp(firebaseConfig, 'miakapp-staging-browser-attestation');
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: false,
    });
    const tokenResult = await getToken(appCheck, true);
    const ttlSeconds = Math.round((tokenResult.expireTimeMillis - Date.now()) / 1000);
    const jwtSegments = tokenResult.token.split('.').length;
    const durationMilliseconds = Math.round(performance.now() - startedAt);
    if (tokenResult.token.length < 64 || tokenResult.token.length > 16 * 1024
      || jwtSegments !== 3
      || !Number.isInteger(ttlSeconds) || ttlSeconds < 3000 || ttlSeconds > 3700
      || durationMilliseconds < 0 || durationMilliseconds > 90_000) {
      throw new Error('closed-attestation-shape-rejected');
    }
    setState('passed');
    return Object.freeze({
      schema: 'miakapp.browser-app-check-attestation/2',
      state: 'passed',
      challenge,
      attestation_attempts: 1,
      token_format: 'jwt-three-segments',
      token_ttl_seconds: ttlSeconds,
      duration_milliseconds: durationMilliseconds,
    });
  } catch {
    setState('failed');
    return Object.freeze({
      schema: 'miakapp.browser-app-check-attestation/2',
      state: 'failed',
      challenge: requestIsValid ? challenge : 'invalid',
      attestation_attempts: 1,
      failure: 'provider-or-token-shape-rejected',
    });
  } finally {
    if (app !== undefined) await deleteApp(app).catch(() => {});
  }
}

const attestation = attest();
Object.defineProperty(window, '__MIAKAPP_BROWSER_ATTESTATION__', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: attestation,
});

void attestation.then((result) => {
  if (!requestIsValid) return;
  setState('returning');
  window.location.replace(`${callback.toString()}#${encodeURIComponent(JSON.stringify(result))}`);
}).catch(() => {
  setState('failed');
});
