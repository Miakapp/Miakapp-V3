export const BROWSER_ORDER = Object.freeze(['chromium', 'firefox', 'webkit']);
export const TARGET_ORIGIN = 'https://miakapp-v4-staging.web.app';
export const PAGE_DIRECTORY = '/__acceptance/browser-relay';
export const PAGE_PATH = `${PAGE_DIRECTORY}/`;
export const TARGET_URL = `${TARGET_ORIGIN}${PAGE_PATH}`;
export const CONTROL_PLANE_ORIGIN = 'https://control-plane-aczhngqraq-od.a.run.app';
export const CONTROL_PLANE_EXCHANGE_ENDPOINT =
  `${CONTROL_PLANE_ORIGIN}/v1/user-relay-tokens:exchange`;
export const RELAY_A_URL =
  'wss://miakapp-staging-relay-a-aczhngqraq-od.a.run.app/ws';
export const RELAY_B_URL =
  'wss://miakapp-staging-relay-b-aczhngqraq-od.a.run.app/ws';
export const HOME_ID = 'miakapp-v4-staging-browser-relay-v1';
export const PAGE_PRIVATE_INPUT_SCHEMA = 'miakapp.staging-browser-relay-page-input/1';
export const PAGE_OBSERVATION_SCHEMA = 'miakapp.staging-browser-relay-page-observation/1';
export const PAGE_LIFECYCLE_OBSERVATION_SCHEMA =
  'miakapp.staging-browser-relay-page-lifecycle-observation/1';
export const MAXIMUM_RUNNER_MILLISECONDS = 720_000;
export const MAXIMUM_CHROMIUM_MILLISECONDS = 600_000;
export const MAXIMUM_FIREFOX_MILLISECONDS = 60_000;
export const MAXIMUM_WEBKIT_MILLISECONDS = 60_000;
export const MAXIMUM_CALLBACK_MILLISECONDS = 900_000;
export const MAXIMUM_PUBLIC_WINDOW_MILLISECONDS = 1_200_000;
export const CALLBACK_CLEANUP_RESERVE_MILLISECONDS =
  MAXIMUM_CALLBACK_MILLISECONDS - MAXIMUM_RUNNER_MILLISECONDS;
export const EDGE_ROLLBACK_RESERVE_MILLISECONDS =
  MAXIMUM_PUBLIC_WINDOW_MILLISECONDS - MAXIMUM_CALLBACK_MILLISECONDS;

const CUSTOM_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const PRIVATE_MATERIAL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];
const FORBIDDEN_OUTPUT_KEYS = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'cookie',
  'email',
  'execution_identifier',
  'firebase_custom_token',
  'firebase_id_token',
  'firebase_uid',
  'har',
  'home_traffic',
  'id_token',
  'password',
  'private_key',
  'raw_request',
  'raw_response',
  'refresh_token',
  'request_headers',
  'response_headers',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);
const PAGE_STATES = [
  'dormant',
  'initialized',
  'ready',
  'stopping',
  'suspended',
  'stopped',
  'failed',
];
const CLIENT_STATUSES = [
  'idle',
  'connecting',
  'authenticating',
  'synchronizing',
  'ready',
  'reconnecting',
  'draining',
  'stopping',
  'stopped',
];
const FAILURE_CLASS = /^(?:protocol|authentication|authorization|conflict|invalid_lifecycle|unavailable|cancelled|internal):(?:not_dispatched|accepted|applied|failed|outcome_unknown)$/u;

export class StagingBrowserRelayPageError extends Error {
  constructor(message = 'Staging browser-relay page boundary is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayPageError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayPageError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value, keys, path) {
  if (!plainObject(value) || !sameStringArray(sortedKeys(value), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (value !== expected) reject(`${path} has drifted`);
}

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

export function rejectPagePrivateMaterial(value, path = 'output') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPagePrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_OUTPUT_KEYS.has(key)) reject(`${path}.${key} is forbidden output`);
      rejectPagePrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

export function validatePagePrivateInput(value) {
  const input = exactKeys(value, [
    'schema',
    'browser',
    'firebase_custom_token',
  ], 'private_input');
  exact(input.schema, PAGE_PRIVATE_INPUT_SCHEMA, 'private_input.schema');
  if (!BROWSER_ORDER.includes(input.browser)) reject('private_input.browser is invalid');
  if (typeof input.firebase_custom_token !== 'string'
    || input.firebase_custom_token.length < 64
    || input.firebase_custom_token.length > 8_192
    || !CUSTOM_TOKEN.test(input.firebase_custom_token)) {
    reject('private_input.firebase_custom_token is invalid');
  }
  return Object.freeze({ ...input });
}

function boundedUniqueStrings(value, allowed, maximum, path) {
  if (!Array.isArray(value)
    || value.length > maximum
    || value.some((entry) => typeof entry !== 'string' || !allowed.includes(entry))
    || new Set(value).size !== value.length) {
    reject(`${path} is not a bounded reviewed set`);
  }
  return Object.freeze([...value]);
}

export function validatePageSafeObservation(value) {
  rejectPagePrivateMaterial(value);
  const observation = exactKeys(value, [
    'schema',
    'browser',
    'state',
    'client_instances',
    'firebase_auth_sessions',
    'app_check_instances',
    'firebase_token_requests',
    'app_check_token_requests',
    'control_plane_exchanges',
    'exchange_cache_conformant',
    'websocket_connections',
    'active_websockets',
    'maximum_active_websockets',
    'source_credentials_on_websocket',
    'browser_credential_persistence_events',
    'relay_ids',
    'client_statuses',
    'failure_classes',
    'duration_milliseconds',
  ], 'observation');
  exact(observation.schema, PAGE_OBSERVATION_SCHEMA, 'observation.schema');
  if (observation.browser !== undefined && !BROWSER_ORDER.includes(observation.browser)) {
    reject('observation.browser is invalid');
  }
  if (!PAGE_STATES.includes(observation.state)) reject('observation.state is invalid');
  boundedInteger(observation.client_instances, 0, 4, 'observation.client_instances');
  boundedInteger(observation.firebase_auth_sessions, 0, 1, 'observation.firebase_auth_sessions');
  boundedInteger(observation.app_check_instances, 0, 1, 'observation.app_check_instances');
  boundedInteger(observation.firebase_token_requests, 0, 16,
    'observation.firebase_token_requests');
  boundedInteger(observation.app_check_token_requests, 0, 16,
    'observation.app_check_token_requests');
  boundedInteger(observation.control_plane_exchanges, 0, 16,
    'observation.control_plane_exchanges');
  if (typeof observation.exchange_cache_conformant !== 'boolean') {
    reject('observation.exchange_cache_conformant is invalid');
  }
  boundedInteger(observation.websocket_connections, 0, 4,
    'observation.websocket_connections');
  boundedInteger(observation.active_websockets, 0, 1, 'observation.active_websockets');
  boundedInteger(observation.maximum_active_websockets, 0, 1,
    'observation.maximum_active_websockets');
  exact(observation.source_credentials_on_websocket, 0,
    'observation.source_credentials_on_websocket');
  exact(observation.browser_credential_persistence_events, 0,
    'observation.browser_credential_persistence_events');
  const relayIds = boundedUniqueStrings(
    observation.relay_ids,
    ['relay-a', 'relay-b'],
    2,
    'observation.relay_ids',
  );
  if (relayIds.length === 2 && !sameStringArray(relayIds, ['relay-a', 'relay-b'])) {
    reject('observation.relay_ids is out of order');
  }
  if (!Array.isArray(observation.client_statuses)
    || observation.client_statuses.length > 64
    || observation.client_statuses.some((entry) => !CLIENT_STATUSES.includes(entry))) {
    reject('observation.client_statuses is invalid');
  }
  if (!Array.isArray(observation.failure_classes)
    || observation.failure_classes.length > 64
    || observation.failure_classes.some((entry) => (
      typeof entry !== 'string' || !FAILURE_CLASS.test(entry)
    ))) {
    reject('observation.failure_classes is invalid');
  }
  boundedInteger(observation.duration_milliseconds, 0, MAXIMUM_RUNNER_MILLISECONDS,
    'observation.duration_milliseconds');
  return Object.freeze({
    ...observation,
    relay_ids: relayIds,
    client_statuses: Object.freeze([...observation.client_statuses]),
    failure_classes: Object.freeze([...observation.failure_classes]),
  });
}

export function validatePageLifecycleObservation(value) {
  rejectPagePrivateMaterial(value, 'lifecycle');
  const observation = exactKeys(value, [
    'schema', 'browser', 'events', 'suspensions', 'resumptions', 'sign_outs',
    'disposals', 'state_transitions', 'call_outcomes',
  ], 'lifecycle');
  exact(observation.schema, PAGE_LIFECYCLE_OBSERVATION_SCHEMA, 'lifecycle.schema');
  if (!BROWSER_ORDER.includes(observation.browser)) reject('lifecycle.browser is invalid');
  for (const field of ['events', 'state_transitions', 'call_outcomes']) {
    if (!Array.isArray(observation[field]) || observation[field].length > 64) {
      reject(`lifecycle.${field} is outside its reviewed bound`);
    }
  }
  const events = observation.events.map((value) => {
    const event = exactKeys(value, ['event', 'persisted'], 'lifecycle.events');
    if (!['pagehide', 'pageshow'].includes(event.event)
      || typeof event.persisted !== 'boolean') reject('lifecycle.events is invalid');
    return Object.freeze({ ...event });
  });
  const transitions = observation.state_transitions.map((value) => {
    const transition = exactKeys(value, ['revision', 'stale'], 'lifecycle.state_transitions');
    boundedInteger(transition.revision, 0, Number.MAX_SAFE_INTEGER, 'lifecycle.revision');
    if (typeof transition.stale !== 'boolean') reject('lifecycle.stale is invalid');
    return Object.freeze({ ...transition });
  });
  if (observation.call_outcomes.some((outcome) => (
    !['applied', 'failed', 'outcome_unknown'].includes(outcome)
  ))) reject('lifecycle.call_outcomes is invalid');
  for (const field of ['suspensions', 'resumptions']) {
    boundedInteger(observation[field], 0, 4, `lifecycle.${field}`);
  }
  for (const field of ['sign_outs', 'disposals']) {
    boundedInteger(observation[field], 0, 1, `lifecycle.${field}`);
  }
  return Object.freeze({
    ...observation,
    events: Object.freeze(events),
    state_transitions: Object.freeze(transitions),
    call_outcomes: Object.freeze([...observation.call_outcomes]),
  });
}
