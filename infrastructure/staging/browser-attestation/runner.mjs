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

function classifyExchangeStatus(error) {
  const status = Number(error?.customData?.httpStatus);
  if ([400, 401, 403, 404, 409, 429].includes(status)) {
    return `app-check-exchange-http-${status}`;
  }
  if (Number.isInteger(status) && status >= 500 && status <= 599) {
    return 'app-check-exchange-http-5xx';
  }
  return 'app-check-exchange-http-other';
}

function classifyProviderFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'appCheck/initial-throttle') return classifyExchangeStatus(error);
  if (code === 'appCheck/fetch-network-error') return 'app-check-fetch-network-error';
  if (code === 'appCheck/fetch-parse-error') return 'app-check-fetch-parse-error';
  if (code === 'appCheck/recaptcha-error') return 'app-check-recaptcha-error';
  if (code === 'appCheck/throttled') return 'app-check-throttled';
  if (code.startsWith('appCheck/')) return 'app-check-sdk-error';
  return 'provider-rejection';
}

async function attest() {
  const startedAt = performance.now();
  let app;
  let failureStage = 'firebase-initialization';
  let failureCode = 'initialization-rejected';
  try {
    if (!requestIsValid) throw new Error('closed-request-shape-rejected');
    app = initializeApp(firebaseConfig, 'miakapp-staging-browser-attestation');
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: false,
    });
    failureStage = 'provider-token-request';
    failureCode = 'provider-rejection';
    let tokenResult;
    try {
      tokenResult = await getToken(appCheck, true);
    } catch (error) {
      failureCode = classifyProviderFailure(error);
      throw error;
    }
    const durationMilliseconds = Math.round(performance.now() - startedAt);
    failureStage = 'token-format-validation';
    failureCode = 'token-format-rejected';
    if (typeof tokenResult?.token !== 'string'
      || tokenResult.token.length < 64 || tokenResult.token.length > 16 * 1024
      || tokenResult.token.split('.').length !== 3) {
      throw new Error('closed-attestation-shape-rejected');
    }
    failureStage = 'token-ttl-validation';
    failureCode = 'token-ttl-rejected';
    const ttlSeconds = Math.round((tokenResult.expireTimeMillis - Date.now()) / 1000);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 3000 || ttlSeconds > 3700) {
      throw new Error('closed-attestation-ttl-rejected');
    }
    failureStage = 'duration-bound-validation';
    failureCode = 'duration-bound-rejected';
    if (!Number.isInteger(durationMilliseconds)
      || durationMilliseconds < 0 || durationMilliseconds > 90_000) {
      throw new Error('closed-attestation-duration-rejected');
    }
    setState('passed');
    return Object.freeze({
      schema: 'miakapp.browser-app-check-attestation/3',
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
      schema: 'miakapp.browser-app-check-attestation/3',
      state: 'failed',
      challenge: requestIsValid ? challenge : 'invalid',
      attestation_attempts: 1,
      failure_stage: failureStage,
      failure_code: failureCode,
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
