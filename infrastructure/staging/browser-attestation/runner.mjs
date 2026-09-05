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
const challengeIsValid = [...parameters.keys()].length === 1
  && /^[0-9a-f]{64}$/u.test(challenge ?? '');

function setState(value) {
  if (!(status instanceof HTMLElement)) return;
  status.dataset.miaState = value;
  status.textContent = value === 'passed'
    ? 'Staging attestation passed'
    : 'Staging attestation failed';
}

async function attest() {
  const startedAt = performance.now();
  let app;
  try {
    if (!challengeIsValid) throw new Error('closed-challenge-shape-rejected');
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
      challenge: challengeIsValid ? challenge : 'invalid',
      attestation_attempts: 1,
      failure: 'provider-or-token-shape-rejected',
    });
  } finally {
    if (app !== undefined) await deleteApp(app).catch(() => {});
  }
}

Object.defineProperty(window, '__MIAKAPP_BROWSER_ATTESTATION__', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: attest(),
});
