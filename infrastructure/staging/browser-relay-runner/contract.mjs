import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const BROWSER_RELAY_RUNNER_PROFILE_PATH = 'browser-relay-runner/profile.json';
export const BROWSER_RELAY_RUNNER_PROFILE_SHA256 =
  '72b688ccd577f7b40b21d9f874bbca555324eaec1fbf2acbc87dee35cf83a536';
export const BROWSER_RELAY_V9_PLAN_SHA256 =
  'bdf2cea284b1031a2a78e3ab029a733cad5e68efde8e9e01c5230e01fe8333dc';
export const BROWSER_RELAY_TARGET_URL =
  'https://miakapp-v4-staging.web.app/__acceptance/browser-relay/';
export const BROWSER_ORDER = Object.freeze(['chromium', 'firefox', 'webkit']);
export const ENGINE_RESULT_SCHEMA = 'miakapp.staging-browser-relay-engine-result/1';
export const RUNNER_RESULT_SCHEMA = 'miakapp.staging-browser-relay-runner-result/1';
export const MAXIMUM_TOTAL_MILLISECONDS = 840_000;
export const BROWSER_DEADLINES_MILLISECONDS = Object.freeze({
  chromium: 720_000,
  firefox: 60_000,
  webkit: 60_000,
});
export const MAXIMUM_NAVIGATION_MILLISECONDS = 30_000;
export const MAXIMUM_PRIVATE_INPUT_BYTES = 65_536;

const MAXIMUM_PROFILE_BYTES = 20 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const REVISION_ID = /^(?:control-plane|miakapp-staging-relay-[ab])-[0-9]{5}-[a-z0-9]{3}$/u;
const PRIVATE_MATERIAL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\bya29\.[A-Za-z0-9._-]+\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];
const FORBIDDEN_FIELD_NAMES = new Set([
  'access_token',
  'app_check_token',
  'authorization',
  'cookie',
  'email',
  'execution_identifier',
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
  'secret_value',
  'token',
  'trace_context',
  'video',
  'websocket_frame',
]);
const COUNTER_KEYS = Object.freeze([
  'app_check_assessments',
  'control_plane_exchanges',
  'kms_signatures',
  'firestore_writes',
  'maximum_active_websockets',
  'source_credentials_on_websocket',
  'browser_credential_persistence_events',
  'physical_call_replays',
]);
const COUNTER_MAXIMUMS = Object.freeze({
  app_check_assessments: 16,
  control_plane_exchanges: 16,
  kms_signatures: 16,
  firestore_writes: 64,
  maximum_active_websockets: 1,
  source_credentials_on_websocket: 0,
  browser_credential_persistence_events: 0,
  physical_call_replays: 0,
});
const OUTCOME_ORDER = Object.freeze([
  'accepted',
  'applied',
  'failed',
  'outcome_unknown',
  'stale',
]);

const expectedProfile = JSON.parse(
  readFileSync(new URL('profile.json', import.meta.url), 'utf8'),
);

export class StagingBrowserRelayRunnerError extends Error {
  constructor(message = 'Staging browser-relay runner is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayRunnerError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayRunnerError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, path) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return value;
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${path} is outside its reviewed bound`);
  }
  return value;
}

function rejectPrivateMaterial(value, path = 'result') {
  if (typeof value === 'string') {
    if (PRIVATE_MATERIAL.some((pattern) => pattern.test(value))) {
      reject(`${path} contains credential material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) reject(`${path}.${key} is forbidden output`);
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function validateProfileValue(value) {
  rejectPrivateMaterial(value, 'profile');
  const profile = exactKeys(value, [
    'schema',
    'revision',
    'state',
    'target',
    'pins',
    'execution',
    'assertions',
    'output',
    'evidence',
  ], 'profile');
  exact(profile.schema, 'miakapp.staging-browser-relay-runner-profile/1', 'profile.schema');
  exact(profile.revision, 1, 'profile.revision');
  exact(
    profile.state,
    'three_engine_closed_runner_implemented_not_executed',
    'profile.state',
  );
  exact(profile, expectedProfile, 'profile');
  exact(profile.target.project_id, 'miakapp-v4-staging', 'profile.target.project_id');
  exact(
    `${profile.target.origin}${profile.target.path}`,
    BROWSER_RELAY_TARGET_URL,
    'profile.target URL',
  );
  exact(profile.target.cloud_compute_resources, 0, 'profile.target.cloud_compute_resources');
  exact(profile.target.unscheduled, true, 'profile.target.unscheduled');
  exact(
    profile.target.cloud_mutation_authorized_by_profile,
    false,
    'profile.target.cloud_mutation_authorized_by_profile',
  );
  exact(
    profile.target.public_ingress_authorized_by_profile,
    false,
    'profile.target.public_ingress_authorized_by_profile',
  );
  exact(
    profile.target.live_execution_authorized_by_profile,
    false,
    'profile.target.live_execution_authorized_by_profile',
  );
  for (const field of ['miakapp_v3_commit', 'miakapi_commit']) {
    if (!COMMIT.test(profile.pins[field])) reject(`profile.pins.${field} is not a full commit`);
  }
  exact(
    profile.pins.browser_relay_plan_sha256,
    BROWSER_RELAY_V9_PLAN_SHA256,
    'profile.pins.browser_relay_plan_sha256',
  );
  if (!SHA256.test(profile.pins.browser_relay_plan_sha256)) {
    reject('profile.pins.browser_relay_plan_sha256 is not a SHA-256 digest');
  }
  for (const field of [
    'runner_driver_sha256',
    'offline_smoke_sha256',
    'ci_workflow_sha256',
    'dependency_lock_sha256',
  ]) {
    if (!SHA256.test(profile.pins[field])) {
      reject(`profile.pins.${field} is not a SHA-256 digest`);
    }
  }
  exact(profile.execution.browser_order, BROWSER_ORDER, 'profile.execution.browser_order');
  exact(profile.execution.maximum_invocations, 3, 'profile.execution.maximum_invocations');
  exact(profile.execution.sequential, true, 'profile.execution.sequential');
  exact(profile.execution.headless, true, 'profile.execution.headless');
  exact(
    profile.execution.private_input_delivery,
    'process_memory_to_page_argument',
    'profile.execution.private_input_delivery',
  );
  exact(profile.execution.service_workers, 'block', 'profile.execution.service_workers');
  for (const field of [
    'persistent_browser_profile',
    'storage_state',
    'downloads',
    'trace_recording',
    'har_recording',
    'video_recording',
    'screenshot_recording',
    'websocket_frame_recording',
    'browser_console_collection',
    'playwright_diagnostics',
  ]) exact(profile.execution[field], false, `profile.execution.${field}`);
  exact(profile.execution.maximum_total_milliseconds, MAXIMUM_TOTAL_MILLISECONDS,
    'profile.execution.maximum_total_milliseconds');
  exact(profile.execution.browser_deadlines_milliseconds, BROWSER_DEADLINES_MILLISECONDS,
    'profile.execution.browser_deadlines_milliseconds');
  exact(
    Object.values(profile.execution.browser_deadlines_milliseconds)
      .reduce((total, duration) => total + duration, 0),
    MAXIMUM_TOTAL_MILLISECONDS,
    'profile.execution browser deadline sum',
  );
  exact(profile.execution.maximum_navigation_milliseconds, MAXIMUM_NAVIGATION_MILLISECONDS,
    'profile.execution.maximum_navigation_milliseconds');
  exact(profile.execution.maximum_private_input_bytes_per_browser, MAXIMUM_PRIVATE_INPUT_BYTES,
    'profile.execution.maximum_private_input_bytes_per_browser');
  exact(Object.keys(profile.assertions), BROWSER_ORDER, 'profile.assertions engines');
  exact(profile.assertions.chromium.length, 36, 'profile.assertions.chromium');
  exact(profile.assertions.firefox.length, 2, 'profile.assertions.firefox');
  exact(profile.assertions.webkit.length, 2, 'profile.assertions.webkit');
  exact(profile.output.engine_result_schema, ENGINE_RESULT_SCHEMA,
    'profile.output.engine_result_schema');
  exact(profile.output.runner_result_schema, RUNNER_RESULT_SCHEMA,
    'profile.output.runner_result_schema');
  exact(profile.output.required_zero_counters, [
    'source_credentials_on_websocket',
    'browser_credential_persistence_events',
    'physical_call_replays',
  ], 'profile.output.required_zero_counters');
  exact(profile.evidence, {
    state: 'absent',
    live_execution_count: 0,
    result_path: null,
    credentials_committed: false,
    raw_diagnostics_committed: false,
  }, 'profile.evidence');
  return Object.freeze(profile);
}

export function validateBrowserRelayRunnerProfile(
  path = new URL('profile.json', import.meta.url),
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_PROFILE_BYTES) {
    reject('Browser-relay runner profile must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex')
    !== BROWSER_RELAY_RUNNER_PROFILE_SHA256) {
    reject('Browser-relay runner profile digest has drifted');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Browser-relay runner profile is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('Browser-relay runner profile is not canonical JSON');
  }
  return validateProfileValue(value);
}

function sortedUniqueStrings(value, allowed, maximum, path) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((entry) => typeof entry !== 'string')
    || new Set(value).size !== value.length) {
    reject(`${path} must be a bounded unique string array`);
  }
  const order = allowed ?? [...value].sort();
  const sorted = [...value].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  if (!isDeepStrictEqual(value, sorted)
    || (allowed !== null && value.some((entry) => !allowed.includes(entry)))) {
    reject(`${path} contains an unknown or unordered value`);
  }
  return Object.freeze([...value]);
}

export function validateEngineResult(value, browser) {
  if (!BROWSER_ORDER.includes(browser)) reject('Engine result browser is not reviewed');
  rejectPrivateMaterial(value);
  const result = exactKeys(value, [
    'schema',
    'browser',
    'state',
    'assertions',
    'counters',
    'duration_milliseconds',
    'public_key_ids',
    'revision_ids',
    'stable_outcome_classes',
  ], 'result');
  exact(result.schema, ENGINE_RESULT_SCHEMA, 'result.schema');
  exact(result.browser, browser, 'result.browser');
  exact(result.state, 'succeeded', 'result.state');
  const expectedAssertions = expectedProfile.assertions[browser];
  exactKeys(result.assertions, expectedAssertions, 'result.assertions');
  for (const assertion of expectedAssertions) {
    exact(result.assertions[assertion], true, `result.assertions.${assertion}`);
  }
  exactKeys(result.counters, COUNTER_KEYS, 'result.counters');
  for (const key of COUNTER_KEYS) {
    boundedInteger(result.counters[key], 0, COUNTER_MAXIMUMS[key], `result.counters.${key}`);
  }
  boundedInteger(
    result.duration_milliseconds,
    0,
    BROWSER_DEADLINES_MILLISECONDS[browser],
    'result.duration_milliseconds',
  );
  const publicKeyIds = sortedUniqueStrings(
    result.public_key_ids,
    ['1', '2'],
    2,
    'result.public_key_ids',
  );
  const revisionIds = sortedUniqueStrings(
    result.revision_ids,
    null,
    8,
    'result.revision_ids',
  );
  if (revisionIds.some((revision) => !REVISION_ID.test(revision))) {
    reject('result.revision_ids contains an invalid revision identifier');
  }
  const stableOutcomeClasses = sortedUniqueStrings(
    result.stable_outcome_classes,
    OUTCOME_ORDER,
    OUTCOME_ORDER.length,
    'result.stable_outcome_classes',
  );
  return Object.freeze({
    ...result,
    assertions: Object.freeze({ ...result.assertions }),
    counters: Object.freeze({ ...result.counters }),
    public_key_ids: publicKeyIds,
    revision_ids: revisionIds,
    stable_outcome_classes: stableOutcomeClasses,
  });
}

export function buildClosedRunnerResult(engineResults, durationMilliseconds) {
  if (!Array.isArray(engineResults) || engineResults.length !== BROWSER_ORDER.length) {
    reject('Runner requires exactly three engine results');
  }
  boundedInteger(durationMilliseconds, 0, MAXIMUM_TOTAL_MILLISECONDS,
    'runner.duration_milliseconds');
  const validated = engineResults.map((result, index) => (
    validateEngineResult(result, BROWSER_ORDER[index])
  ));
  const reportedDuration = validated.reduce(
    (total, result) => total + result.duration_milliseconds,
    0,
  );
  if (reportedDuration > durationMilliseconds) {
    reject('Runner duration is shorter than its engine durations');
  }
  const sum = (key) => validated.reduce((total, result) => total + result.counters[key], 0);
  const counters = {
    app_check_assessments: sum('app_check_assessments'),
    control_plane_exchanges: sum('control_plane_exchanges'),
    kms_signatures: sum('kms_signatures'),
    firestore_writes: sum('firestore_writes'),
    maximum_active_websockets: Math.max(
      ...validated.map(({ counters: value }) => value.maximum_active_websockets),
    ),
    source_credentials_on_websocket: sum('source_credentials_on_websocket'),
    browser_credential_persistence_events: sum('browser_credential_persistence_events'),
    physical_call_replays: sum('physical_call_replays'),
  };
  for (const key of COUNTER_KEYS) {
    boundedInteger(counters[key], 0, COUNTER_MAXIMUMS[key], `runner.counters.${key}`);
  }
  const union = (field, order = null) => {
    const values = [...new Set(validated.flatMap((result) => result[field]))];
    return Object.freeze(order === null
      ? values.sort()
      : values.sort((left, right) => order.indexOf(left) - order.indexOf(right)));
  };
  const compactResults = Object.freeze(validated.map((result, index) => Object.freeze({
    browser: BROWSER_ORDER[index],
    state: result.state,
    assertions_passed: expectedProfile.assertions[BROWSER_ORDER[index]].length,
    assertions_failed: 0,
    duration_milliseconds: result.duration_milliseconds,
  })));
  return Object.freeze({
    schema: RUNNER_RESULT_SCHEMA,
    state: 'succeeded_closed_output',
    browser_order: BROWSER_ORDER,
    browser_invocations: 3,
    assertions_passed: 40,
    assertions_failed: 0,
    duration_milliseconds: durationMilliseconds,
    counters: Object.freeze(counters),
    public_key_ids: union('public_key_ids', ['1', '2']),
    revision_ids: union('revision_ids'),
    stable_outcome_classes: union('stable_outcome_classes', OUTCOME_ORDER),
    recordings: Object.freeze({
      trace: false,
      har: false,
      video: false,
      screenshot: false,
      websocket_frame: false,
      browser_console: false,
    }),
    browser_credentials_persisted: false,
    engine_results: compactResults,
  });
}

export function validatePrivatePageInput(value) {
  if (!plainObject(value)) reject('Private browser input must be an object');
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return reject('Private browser input must be JSON-serializable');
  }
  if (bytes === 0 || bytes > MAXIMUM_PRIVATE_INPUT_BYTES) {
    reject('Private browser input is outside its in-memory size bound');
  }
  return value;
}
