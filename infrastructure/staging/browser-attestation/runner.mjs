import { deleteApp, initializeApp } from 'firebase/app';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';

const firebaseConfig = __MIAKAPP_FIREBASE_CONFIG__;
const recaptchaSiteKey = __MIAKAPP_RECAPTCHA_SITE_KEY__;
const status = document.querySelector('[data-mia-state]');

function setState(value) {
  if (!(status instanceof HTMLElement)) return;
  status.dataset.miaState = value;
  status.textContent = value === 'passed'
    ? 'Staging attestation passed'
    : 'Staging attestation failed';
}

async function attest() {
  const startedAt = performance.now();
  const app = initializeApp(firebaseConfig, 'miakapp-staging-browser-attestation');
  try {
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
      || durationMilliseconds < 0 || durationMilliseconds > 120_000) {
      throw new Error('closed-attestation-shape-rejected');
    }
    setState('passed');
    return Object.freeze({
      schema: 'miakapp.browser-app-check-attestation/1',
      state: 'passed',
      engine: 'chromium',
      mode: 'headed',
      attestation_attempts: 1,
      token_format: 'jwt-three-segments',
      token_ttl_seconds: ttlSeconds,
      duration_milliseconds: durationMilliseconds,
    });
  } catch {
    setState('failed');
    return Object.freeze({
      schema: 'miakapp.browser-app-check-attestation/1',
      state: 'failed',
      failure: 'provider-or-token-shape-rejected',
    });
  } finally {
    await deleteApp(app);
  }
}

Object.defineProperty(window, '__MIAKAPP_BROWSER_ATTESTATION__', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: attest(),
});
