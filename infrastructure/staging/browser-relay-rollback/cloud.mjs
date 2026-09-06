import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createGoogleEdgeClient } from '../browser-relay-edge/cloud.mjs';
import { validateCanonicalPrivateInventory } from '../browser-relay-edge/inventory.mjs';
import { observeHostingInventory } from '../browser-attestation/inventory.mjs';
import {
  validateRelayServicesPrivateReadyResult,
} from '../browser-relay-services/contract.mjs';
import {
  observeRelayServicesInventory,
  relayServicesInventorySha256,
  validateRelayServicesPrivateReadyInventory,
} from '../browser-relay-services/inventory.mjs';
import {
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  RUNNER_URL,
  buildRollbackPreflightResult,
  summarizeRelayTerraformNoChangePlan,
  validateBrowserRelayRollbackProfile,
  validateRollbackCloudObservation,
} from './contract.mjs';

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const TECHNICAL_COLLECTIONS = Object.freeze([
  'controlAdmissionBuckets',
  'controlAdmissionState',
  'controlAudit',
]);

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function validateSession(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), ['accessToken'])
    || typeof value.accessToken !== 'string'
    || value.accessToken.length < 20 || value.accessToken.length > 16 * 1024
    || /\s/u.test(value.accessToken)) {
    reject('Rollback preflight requires a verified ephemeral operator session');
  }
  return value;
}

function validateTransport(value) {
  if (typeof value !== 'function') reject('Rollback preflight requires an HTTP transport');
  return value;
}

function headers(accessToken, contentType = false) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    ...(contentType ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
  };
}

async function requestJson(
  fetchImplementation,
  session,
  url,
  { method = 'GET', body, description },
) {
  if (!['GET', 'POST'].includes(method)
    || (method === 'GET' && body !== undefined)
    || typeof description !== 'string') {
    reject('Rollback preflight request is outside the read-only transport boundary');
  }
  let response;
  try {
    response = await fetchImplementation(url, {
      method,
      headers: headers(session.accessToken, body !== undefined),
      ...(body === undefined ? {} : { body }),
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
    reject(`${description} returned an unexpected response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

async function observeRunnerRoute(fetchImplementation) {
  let response;
  try {
    response = await fetchImplementation(RUNNER_URL, {
      method: 'HEAD',
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30_000),
    });
  } catch {
    return reject('Rollback runner-route observation failed');
  }
  if (response.status !== 404) reject('Acceptance runner route is not absent');
  return response.status;
}

export async function observeRollbackPrivateBoundary(
  sessionValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const edgeClient = createGoogleEdgeClient(
    { accessToken: session.accessToken },
    { fetchImplementation: transport },
  );
  const [edgeValue, relayValue] = await Promise.all([
    edgeClient.observe(),
    observeRelayServicesInventory(session, transport),
  ]);
  const edge = validateCanonicalPrivateInventory(edgeValue);
  const readyResult = validateRelayServicesPrivateReadyResult();
  const relays = validateRelayServicesPrivateReadyInventory(relayValue, {
    generation: readyResult.claim_generation,
    size_bytes: 1,
  });
  const inventorySha256 = relayServicesInventorySha256(relays);
  if (inventorySha256 !== readyResult.final_inventory_sha256) {
    reject('Live relay inventory differs from the pinned private-ready result');
  }
  const publicInvokers = relays.relays.filter(({ iam_bindings: bindings }) => (
    bindings.some(({ role, members }) => (
      role === 'roles/run.invoker' && members.includes('allUsers')
    ))
  )).length;
  return Object.freeze({
    control_plane: Object.freeze({
      state: edge.state,
      revision: edge.function.revision,
      ingress: edge.function.ingress,
      unauthenticated_invokers: edge.iam.unauthenticated_invokers,
      minimum_instances: edge.function.minimum_instances,
    }),
    relays: Object.freeze({
      phase: 'private_ready',
      services: relays.relays.length,
      public_invokers: publicInvokers,
      service_account_user_managed_keys: relays.relay_service_account.user_managed_keys,
      minimum_instances: Math.max(...relays.relays.map(({ minimum_instances: value }) => value)),
      inventory_sha256: inventorySha256,
    }),
  });
}

export async function observeRollbackHostingBoundary(
  sessionValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const [inventory, routeStatus] = await Promise.all([
    observeHostingInventory(session, transport),
    observeRunnerRoute(transport),
  ]);
  const deletedVersions = inventory.versions.filter(({ status }) => status === 'DELETED').length;
  if (inventory.versions.length !== 6 || deletedVersions !== inventory.versions.length
    || inventory.releases.length !== 6) {
    reject('Firebase Hosting is not at the exact retired rollback target');
  }
  return Object.freeze({
    site_disabled: routeStatus === 404,
    versions: inventory.versions.length,
    deleted_versions: deletedVersions,
    releases: inventory.releases.length,
    runner_route_status: routeStatus,
  });
}

export async function observeRollbackApplicationData(
  sessionValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const usersUrl = new URL(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`,
  );
  usersUrl.searchParams.set('maxResults', '1');
  const collectionsUrl =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:listCollectionIds`;
  const [users, collections] = await Promise.all([
    requestJson(transport, session, usersUrl, {
      description: 'Firebase Auth user inventory',
    }),
    requestJson(transport, session, collectionsUrl, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 100 }),
      description: 'Firestore root collection inventory',
    }),
  ]);
  if (!plainObject(users)
    || (users.users !== undefined && (!Array.isArray(users.users) || users.users.length !== 0))
    || (users.nextPageToken !== undefined && users.nextPageToken !== '')) {
    reject('Firebase Auth contains a user or returned an incomplete inventory');
  }
  if (!plainObject(collections)
    || (collections.collectionIds !== undefined && !Array.isArray(collections.collectionIds))
    || (collections.nextPageToken !== undefined && collections.nextPageToken !== '')) {
    reject('Firestore root collection inventory is malformed or incomplete');
  }
  const ids = [...(collections.collectionIds ?? [])].sort();
  if (!isDeepStrictEqual(ids, TECHNICAL_COLLECTIONS)) {
    reject('Firestore contains an application fixture or an unknown root collection');
  }
  return Object.freeze({
    firebase_auth_users: 0,
    technical_root_collections: Object.freeze(ids),
    application_fixture_collections: 0,
  });
}

export async function observeRollbackIamBoundary(
  sessionValue,
  fetchImplementation = globalThis.fetch,
) {
  const session = validateSession(sessionValue);
  const transport = validateTransport(fetchImplementation);
  const profile = validateBrowserRelayRollbackProfile();
  const policy = await requestJson(
    transport,
    session,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`,
    {
      method: 'POST',
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      description: 'Project IAM rollback inventory',
    },
  );
  if (!plainObject(policy)
    || (policy.bindings !== undefined && !Array.isArray(policy.bindings))) {
    reject('Project IAM rollback inventory is malformed');
  }
  let temporaryAcceptanceBindings = 0;
  let unexpectedPublicProjectBindings = 0;
  for (const binding of policy.bindings ?? []) {
    if (!plainObject(binding) || typeof binding.role !== 'string'
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== 'string')) {
      reject('Project IAM rollback inventory contains a malformed binding');
    }
    const title = binding.condition?.title;
    if (typeof title === 'string'
      && title.startsWith(profile.preflight.temporary_binding_condition_title_prefix)) {
      temporaryAcceptanceBindings += 1;
    }
    if (binding.members.some((member) => ['allUsers', 'allAuthenticatedUsers'].includes(member))) {
      unexpectedPublicProjectBindings += 1;
    }
  }
  if (temporaryAcceptanceBindings !== 0 || unexpectedPublicProjectBindings !== 0) {
    reject('Project IAM is not at the closed rollback target');
  }
  return Object.freeze({
    temporary_acceptance_bindings: temporaryAcceptanceBindings,
    unexpected_public_project_bindings: unexpectedPublicProjectBindings,
  });
}

export async function observeRollbackPreflight(sessionValue, options = {}) {
  const session = validateSession(sessionValue);
  const fetchImplementation = validateTransport(options.fetchImplementation ?? globalThis.fetch);
  const clock = options.clock ?? Date.now;
  const implementationCommit = options.implementationCommit;
  const privateBoundaryObserver = options.privateBoundaryObserver
    ?? observeRollbackPrivateBoundary;
  const hostingObserver = options.hostingObserver ?? observeRollbackHostingBoundary;
  const applicationDataObserver = options.applicationDataObserver
    ?? observeRollbackApplicationData;
  const iamObserver = options.iamObserver ?? observeRollbackIamBoundary;
  if (typeof clock !== 'function' || typeof privateBoundaryObserver !== 'function'
    || typeof hostingObserver !== 'function' || typeof applicationDataObserver !== 'function'
    || typeof iamObserver !== 'function' || typeof implementationCommit !== 'string') {
    reject('Rollback preflight options are invalid');
  }
  const instant = clock();
  if (!Number.isSafeInteger(instant) || instant < 0) {
    reject('Rollback preflight clock returned an invalid instant');
  }
  const terraform = summarizeRelayTerraformNoChangePlan(options.terraformPlan);
  const [boundary, hosting, applicationData, iam] = await Promise.all([
    privateBoundaryObserver(session, fetchImplementation),
    hostingObserver(session, fetchImplementation),
    applicationDataObserver(session, fetchImplementation),
    iamObserver(session, fetchImplementation),
  ]);
  const observation = validateRollbackCloudObservation({
    schema: 'miakapp.staging-browser-relay-rollback-cloud-observation/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: new Date(instant).toISOString(),
    implementation_commit: implementationCommit,
    control_plane: boundary.control_plane,
    relays: boundary.relays,
    hosting,
    application_data: applicationData,
    iam,
    terraform,
    effects: {
      cloud_mutations: 0,
      public_ingress_changes: 0,
      acceptance_executions: 0,
      credentials_retained: false,
      raw_cloud_responses_retained: false,
    },
  });
  return buildRollbackPreflightResult(observation);
}
