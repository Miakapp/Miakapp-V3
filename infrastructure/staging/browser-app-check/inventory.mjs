import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_RISK_SCORE,
  FIREBASE_APP_CONFIG_NAME,
  FIREBASE_APP_DISPLAY_NAME,
  FIREBASE_APP_ID,
  FIREBASE_APP_NAME,
  INTENDED_TOKEN_TTL,
  PROJECT_ID,
  PROJECT_NUMBER,
  RECAPTCHA_API,
} from './contract.mjs';
import {
  verifiedOperatorSession,
} from './cli.mjs';

const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const RECAPTCHA_KEY_NAME = new RegExp(
  `^projects/(?:${PROJECT_ID}|${PROJECT_NUMBER})/keys/[A-Za-z0-9_-]{20,128}$`,
  'u',
);
const RECAPTCHA_ASSET_NAME = new RegExp(
  `^//recaptchaenterprise\\.googleapis\\.com/projects/(?:${PROJECT_ID}|${PROJECT_NUMBER})/keys/[A-Za-z0-9_-]{20,128}$`,
  'u',
);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

async function googleRequest(url, token, description) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Goog-User-Project': PROJECT_ID,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request failed`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response size is invalid`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
  if (response.status !== 200 || !plainObject(value)) {
    reject(`${description} returned an unexpected response`);
  }
  return value;
}

async function firebaseApps(token) {
  const value = await googleRequest(
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps?pageSize=100`,
    token,
    'Firebase Web app inventory',
  );
  if (Object.keys(value).some((key) => !['apps', 'nextPageToken'].includes(key))
    || !Array.isArray(value.apps)
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject('Firebase Web app inventory is malformed');
  }
  return value.apps;
}

export function validateFirebaseWebAppInventory(apps) {
  if (!Array.isArray(apps) || apps.length !== 1) {
    reject('Firebase Web app inventory must contain exactly the reviewed app');
  }
  const app = apps[0];
  if (!plainObject(app)
    || app.appId !== FIREBASE_APP_ID
    || app.name !== FIREBASE_APP_NAME
    || app.displayName !== FIREBASE_APP_DISPLAY_NAME
    || app.projectId !== PROJECT_ID
    || (app.platform !== undefined && app.platform !== 'WEB')
    || app.state !== 'ACTIVE') {
    reject('Firebase Web app inventory does not match the reviewed app');
  }
  return Object.freeze({
    app_id: app.appId,
    name: app.name,
    display_name: app.displayName,
    platform: 'WEB',
    state: app.state,
  });
}

export function validateUnregisteredAppCheckConfig(value) {
  exactKeys(value, ['name', 'riskAnalysis', 'tokenTtl'], 'App Check configuration');
  exactKeys(value.riskAnalysis, ['minValidScore'], 'App Check risk analysis');
  if (value.name !== FIREBASE_APP_CONFIG_NAME
    || value.tokenTtl !== INTENDED_TOKEN_TTL
    || value.riskAnalysis.minValidScore !== DEFAULT_RISK_SCORE) {
    reject('App Check configuration is already registered or has drifted');
  }
  return Object.freeze({
    name: value.name,
    token_ttl: value.tokenTtl,
    minimum_valid_score: value.riskAnalysis.minValidScore,
    site_key_configured: false,
  });
}

function validateEmptyCollection(value, field, description) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => ![field, 'nextPageToken'].includes(key))
    || (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].length !== 0))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject(`${description} must be empty`);
  }
  return 0;
}

async function enabledRecaptchaApi(token) {
  const service = await googleRequest(
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT_NUMBER}/services/${RECAPTCHA_API}`,
    token,
    'reCAPTCHA API inventory',
  );
  if (service.name !== `projects/${PROJECT_NUMBER}/services/${RECAPTCHA_API}`
    || service.config?.name !== RECAPTCHA_API
    || !['ENABLED', 'DISABLED'].includes(service.state)) {
    reject('reCAPTCHA API inventory is malformed');
  }
  return service.state === 'ENABLED';
}

async function recaptchaKeys(token) {
  const value = await googleRequest(
    `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT_ID}/keys?pageSize=100`,
    token,
    'reCAPTCHA key inventory',
  );
  if (Object.keys(value).some((key) => !['keys', 'nextPageToken'].includes(key))
    || (value.keys !== undefined && !Array.isArray(value.keys))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject('reCAPTCHA key inventory is malformed or incomplete');
  }
  const keys = value.keys ?? [];
  if (keys.some((key) => !plainObject(key) || typeof key.name !== 'string'
    || !RECAPTCHA_KEY_NAME.test(key.name))) {
    reject('reCAPTCHA key inventory contains an invalid resource name');
  }
  return keys.map(({ name }) => name).sort();
}

async function recaptchaAssetKeys(token) {
  const value = await googleRequest(
    `https://cloudasset.googleapis.com/v1/projects/${PROJECT_NUMBER}:searchAllResources?assetTypes=recaptchaenterprise.googleapis.com%2FKey&pageSize=100`,
    token,
    'Cloud Asset reCAPTCHA key inventory',
  );
  if (Object.keys(value).some((key) => !['results', 'nextPageToken'].includes(key))
    || (value.results !== undefined && !Array.isArray(value.results))
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject('Cloud Asset reCAPTCHA key inventory is malformed or incomplete');
  }
  const results = value.results ?? [];
  if (results.some((asset) => !plainObject(asset) || typeof asset.name !== 'string'
    || !RECAPTCHA_ASSET_NAME.test(asset.name))) {
    reject('Cloud Asset reCAPTCHA key inventory contains an invalid resource name');
  }
  return results.map(({ name }) => name).sort();
}

export function validateBrowserAppCheckInventory(value, profile) {
  exactKeys(value, [
    'schema',
    'project_id',
    'project_number',
    'firebase_web_app',
    'recaptcha_api_enabled',
    'recaptcha_key_inventory',
    'recaptcha_keys',
    'recaptcha_asset_inventory',
    'recaptcha_asset_keys',
    'app_check',
    'service_enforcement_records',
    'debug_tokens',
  ], 'Browser App Check inventory');
  if (value.schema !== 'miakapp.staging-browser-app-check-inventory/1'
    || value.project_id !== PROJECT_ID
    || value.project_number !== PROJECT_NUMBER
    || !isDeepStrictEqual(value.firebase_web_app, {
      app_id: FIREBASE_APP_ID,
      name: FIREBASE_APP_NAME,
      display_name: FIREBASE_APP_DISPLAY_NAME,
      platform: 'WEB',
      state: 'ACTIVE',
    })
    || !isDeepStrictEqual(value.app_check, {
      name: FIREBASE_APP_CONFIG_NAME,
      token_ttl: INTENDED_TOKEN_TTL,
      minimum_valid_score: DEFAULT_RISK_SCORE,
      site_key_configured: false,
    })
    || value.service_enforcement_records !== 0
    || value.debug_tokens !== 0
    || value.recaptcha_asset_inventory !== 'readable_eventually_consistent'
    || !isDeepStrictEqual(value.recaptcha_asset_keys, [])) {
    reject('Browser App Check inventory has drifted from the reviewed boundary');
  }
  if (profile === 'before-api') {
    if (value.recaptcha_api_enabled !== false
      || value.recaptcha_key_inventory !== 'unavailable_service_disabled'
      || value.recaptcha_keys !== null) {
      reject('Browser App Check pre-API inventory must keep key existence unknown');
    }
  } else if (profile === 'after-api') {
    if (value.recaptcha_api_enabled !== true
      || value.recaptcha_key_inventory !== 'readable'
      || !isDeepStrictEqual(value.recaptcha_keys, [])) {
      reject('Browser App Check post-API inventory is not authoritatively empty');
    }
  } else {
    reject('Browser App Check inventory profile is invalid');
  }
  return Object.freeze(value);
}

export async function observeBrowserAppCheckInventory(session) {
  const operator = session ?? await verifiedOperatorSession();
  if (!plainObject(operator) || typeof operator.accessToken !== 'string') {
    reject('Browser App Check inventory requires a verified operator session');
  }
  const token = operator.accessToken;
  const [webApps, recaptchaApiEnabled, assetKeys] = await Promise.all([
    firebaseApps(token),
    enabledRecaptchaApi(token),
    recaptchaAssetKeys(token),
  ]);
  const webApp = validateFirebaseWebAppInventory(webApps);
  const encodedAppId = encodeURIComponent(FIREBASE_APP_ID);
  const [config, services, debugTokens] = await Promise.all([
    googleRequest(
      `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${encodedAppId}/recaptchaEnterpriseConfig`,
      token,
      'App Check provider inventory',
    ),
    googleRequest(
      `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/services?pageSize=100`,
      token,
      'App Check enforcement inventory',
    ),
    googleRequest(
      `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/apps/${encodedAppId}/debugTokens?pageSize=100`,
      token,
      'App Check debug-token inventory',
    ),
  ]);
  const keys = recaptchaApiEnabled
    ? await recaptchaKeys(token)
    : null;
  return Object.freeze({
    schema: 'miakapp.staging-browser-app-check-inventory/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    firebase_web_app: webApp,
    recaptcha_api_enabled: recaptchaApiEnabled,
    recaptcha_key_inventory: recaptchaApiEnabled ? 'readable' : 'unavailable_service_disabled',
    recaptcha_keys: keys === null ? null : Object.freeze(keys),
    recaptcha_asset_inventory: 'readable_eventually_consistent',
    recaptcha_asset_keys: Object.freeze(assetKeys),
    app_check: validateUnregisteredAppCheckConfig(config),
    service_enforcement_records: validateEmptyCollection(
      services,
      'services',
      'App Check service enforcement inventory',
    ),
    debug_tokens: validateEmptyCollection(
      debugTokens,
      'debugTokens',
      'App Check debug-token inventory',
    ),
  });
}
