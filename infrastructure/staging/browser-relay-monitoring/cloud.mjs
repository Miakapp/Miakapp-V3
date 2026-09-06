import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createGoogleEdgeClient } from '../browser-relay-edge/cloud.mjs';
import { validateCanonicalPrivateInventory } from '../browser-relay-edge/inventory.mjs';
import {
  validateRelayServicesPrivateReadyResult,
} from '../browser-relay-services/contract.mjs';
import {
  observeRelayServicesInventory,
  validateRelayServicesPrivateReadyInventory,
} from '../browser-relay-services/inventory.mjs';
import {
  APPROVED_BILLING_ACCOUNT_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  sha256,
  validateBrowserRelayMonitoringProfile,
  validateMonitoringCloudObservation,
} from './contract.mjs';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const BILLING_ACCOUNT = /^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/u;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function validateSession(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), ['accessToken', 'billingAccountId'])
    || typeof value.accessToken !== 'string' || value.accessToken.length < 20
    || value.accessToken.length > 16 * 1024
    || /\s/u.test(value.accessToken)
    || typeof value.billingAccountId !== 'string'
    || !BILLING_ACCOUNT.test(value.billingAccountId)
    || sha256(value.billingAccountId) !== APPROVED_BILLING_ACCOUNT_SHA256) {
    reject('Monitoring preflight requires the approved ephemeral operator session');
  }
  return value;
}

function validateTransport(value) {
  if (typeof value !== 'function') reject('Monitoring preflight requires an HTTP transport');
  return value;
}

function requestHeaders(accessToken) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
  };
}

async function requestJson(fetchImplementation, accessToken, url, description) {
  let response;
  try {
    response = await fetchImplementation(url, {
      method: 'GET',
      headers: requestHeaders(accessToken),
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30_000),
    });
  } catch {
    return reject(`${description} request failed`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return reject(`${description} response could not be read`);
  }
  if (response.status !== 200 || bytes.byteLength < 2
    || bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    return reject(`${description} returned an unexpected response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function normalizeDescriptor(value, expected) {
  if (!plainObject(value) || value.type !== expected.type
    || typeof value.metricKind !== 'string' || typeof value.valueType !== 'string'
    || typeof value.unit !== 'string' || !Array.isArray(value.monitoredResourceTypes)
    || value.monitoredResourceTypes.some((entry) => typeof entry !== 'string')
    || (value.labels !== undefined && (!Array.isArray(value.labels)
      || value.labels.some((entry) => !plainObject(entry) || typeof entry.key !== 'string')))) {
    reject(`Metric descriptor ${expected.type} is malformed`);
  }
  const normalized = Object.freeze({
    type: value.type,
    metric_kind: value.metricKind,
    value_type: value.valueType,
    unit: value.unit,
    resource_types: Object.freeze([...value.monitoredResourceTypes]),
    labels: Object.freeze((value.labels ?? []).map(({ key }) => key)),
  });
  if (!isDeepStrictEqual(normalized, expected)) {
    reject(`Metric descriptor ${expected.type} has drifted`);
  }
  return normalized;
}

function queryFilter(query) {
  const clauses = [
    `metric.type = "${query.metric_type}"`,
    `resource.type = "${query.resource_type}"`,
  ];
  if (query.service_names.length > 0) {
    clauses.push(`resource.labels.location = "${REGION}"`);
    clauses.push(`resource.labels.service_name = one_of(${query.service_names
      .map((name) => `"${name}"`).join(', ')})`);
  }
  return clauses.join(' AND ');
}

export function buildMonitoringQueryUrl(queryValue, start, end) {
  const profile = validateBrowserRelayMonitoringProfile();
  const query = profile.observation.queries.find(({ id }) => id === queryValue?.id);
  if (query === undefined || !isDeepStrictEqual(queryValue, query)
    || typeof start !== 'string' || typeof end !== 'string') {
    reject('Monitoring query does not match the reviewed allowlist');
  }
  const url = new URL(
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries`,
  );
  url.searchParams.set('filter', queryFilter(query));
  url.searchParams.set('interval.startTime', start);
  url.searchParams.set('interval.endTime', end);
  url.searchParams.set('view', profile.observation.query_view);
  url.searchParams.set('pageSize', String(profile.observation.maximum_series_headers_per_query));
  return url;
}

async function observeDescriptor(fetchImplementation, session, expected) {
  const url = new URL(
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/metricDescriptors/${expected.type}`,
  );
  return normalizeDescriptor(
    await requestJson(fetchImplementation, session.accessToken, url, 'Metric descriptor'),
    expected,
  );
}

async function observeQuery(fetchImplementation, session, query, start, end, profile) {
  const url = buildMonitoringQueryUrl(query, start, end);
  const response = await requestJson(
    fetchImplementation,
    session.accessToken,
    url,
    `Monitoring query ${query.id}`,
  );
  if (!plainObject(response)
    || (response.timeSeries !== undefined && !Array.isArray(response.timeSeries))
    || (response.nextPageToken !== undefined && response.nextPageToken !== '')
    || (response.timeSeries ?? []).length > profile.observation.maximum_series_headers_per_query
    || (response.timeSeries ?? []).some((series) => !plainObject(series)
      || (Array.isArray(series.points) && series.points.length !== 0))) {
    reject(`Monitoring query ${query.id} returned an unbounded response`);
  }
  return Object.freeze({
    id: query.id,
    metric_type: query.metric_type,
    state: 'readable',
    query_interval_seconds: profile.observation.query_interval_seconds,
    query_view: profile.observation.query_view,
    series_headers_observed: (response.timeSeries ?? []).length,
    raw_points_retained: false,
  });
}

function normalizeBudget(value, session, expected) {
  if (!plainObject(value) || typeof value.name !== 'string'
    || !value.name.startsWith(`billingAccounts/${session.billingAccountId}/budgets/`)
    || value.displayName !== expected.display_name
    || !plainObject(value.amount?.specifiedAmount)
    || !plainObject(value.budgetFilter)
    || !Array.isArray(value.budgetFilter.projects)
    || !Array.isArray(value.thresholdRules)
    || !plainObject(value.notificationsRule)) {
    reject('Staging billing budget is malformed');
  }
  const units = Number(value.amount.specifiedAmount.units);
  const thresholds = value.thresholdRules.map((entry) => entry.thresholdPercent);
  const spendBases = [...new Set(value.thresholdRules.map((entry) => entry.spendBasis))];
  const normalized = {
    state: 'configured',
    matching_budgets: 1,
    billing_account_sha256: sha256(session.billingAccountId),
    resource_name_sha256: sha256(value.name),
    display_name: value.displayName,
    project_number: value.budgetFilter.projects.length === 1
      ? value.budgetFilter.projects[0].replace(/^projects\//u, '') : '',
    currency: value.amount.specifiedAmount.currencyCode,
    amount_units: units,
    calendar_period: value.budgetFilter.calendarPeriod,
    credit_types_treatment: value.budgetFilter.creditTypesTreatment,
    thresholds,
    spend_basis: spendBases.length === 1 ? spendBases[0] : '',
    project_level_recipients: value.notificationsRule.enableProjectLevelRecipients === true,
    raw_resource_name_retained: false,
  };
  if (normalized.project_number !== PROJECT_NUMBER
    || normalized.currency !== expected.currency
    || normalized.amount_units !== expected.amount_units
    || normalized.calendar_period !== expected.calendar_period
    || normalized.credit_types_treatment !== expected.credit_types_treatment
    || !isDeepStrictEqual(normalized.thresholds, expected.thresholds)
    || normalized.spend_basis !== expected.spend_basis
    || normalized.project_level_recipients !== expected.project_level_recipients) {
    reject('Staging billing budget has drifted');
  }
  return Object.freeze(normalized);
}

async function observeBudget(fetchImplementation, session, profile) {
  const url = new URL(
    `https://billingbudgets.googleapis.com/v1/billingAccounts/${session.billingAccountId}/budgets`,
  );
  url.searchParams.set('pageSize', '100');
  const response = await requestJson(
    fetchImplementation,
    session.accessToken,
    url,
    'Billing budget inventory',
  );
  if (!plainObject(response)
    || (response.budgets !== undefined && !Array.isArray(response.budgets))
    || (response.nextPageToken !== undefined && response.nextPageToken !== '')) {
    reject('Billing budget inventory is malformed or incomplete');
  }
  const matching = (response.budgets ?? [])
    .filter(({ displayName }) => displayName === profile.observation.billing_budget.display_name);
  if (matching.length !== 1) {
    reject('Billing budget inventory must contain exactly one staging budget');
  }
  return normalizeBudget(matching[0], session, profile.observation.billing_budget);
}

export async function observeLivePrivateBoundary(session, fetchImplementation = globalThis.fetch) {
  const operator = validateSession(session);
  const transport = validateTransport(fetchImplementation);
  const edgeClient = createGoogleEdgeClient(
    { accessToken: operator.accessToken },
    { fetchImplementation: transport },
  );
  const [edgeValue, relayValue] = await Promise.all([
    edgeClient.observe(),
    observeRelayServicesInventory({ accessToken: operator.accessToken }, transport),
  ]);
  const edge = validateCanonicalPrivateInventory(edgeValue);
  const privateReadyResult = validateRelayServicesPrivateReadyResult();
  const relays = validateRelayServicesPrivateReadyInventory(relayValue, {
    generation: privateReadyResult.claim_generation,
    size_bytes: 1,
  });
  return Object.freeze({
    control_plane_state: edge.state,
    control_plane_revision: edge.function.revision,
    control_plane_public_invokers: edge.iam.unauthenticated_invokers,
    relay_phase: 'private_ready',
    relay_services: relays.relays.length,
    relay_public_invokers: relays.relays
      .filter(({ iam_bindings: bindings }) => bindings.some(({ role, members }) => (
        role === 'roles/run.invoker' && members.includes('allUsers')
      ))).length,
  });
}

export async function observeMonitoringPreflight(sessionValue, options = {}) {
  const session = validateSession(sessionValue);
  const fetchImplementation = validateTransport(options.fetchImplementation ?? globalThis.fetch);
  const clock = options.clock ?? Date.now;
  const boundaryObserver = options.boundaryObserver ?? observeLivePrivateBoundary;
  if (typeof clock !== 'function' || typeof boundaryObserver !== 'function') {
    reject('Monitoring preflight options are invalid');
  }
  const instant = clock();
  if (!Number.isSafeInteger(instant) || instant < 0) {
    reject('Monitoring preflight clock returned an invalid instant');
  }
  const profile = validateBrowserRelayMonitoringProfile();
  const end = new Date(instant).toISOString();
  const start = new Date(
    instant - (profile.observation.query_interval_seconds * 1000),
  ).toISOString();
  const [privateBoundary, metricDescriptors, queries, billingBudget] = await Promise.all([
    boundaryObserver(session, fetchImplementation),
    Promise.all(profile.observation.metric_descriptors.map((descriptor) => (
      observeDescriptor(fetchImplementation, session, descriptor)
    ))),
    Promise.all(profile.observation.queries.map((query) => (
      observeQuery(fetchImplementation, session, query, start, end, profile)
    ))),
    observeBudget(fetchImplementation, session, profile),
  ]);
  return validateMonitoringCloudObservation({
    schema: 'miakapp.staging-browser-relay-monitoring-cloud-observation/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: end,
    private_boundary: privateBoundary,
    metric_descriptors: metricDescriptors,
    queries,
    billing_budget: billingBudget,
    raw_retention: {
      metric_points: false,
      time_series: false,
      budget_resource_name: false,
      api_errors: false,
    },
  });
}
