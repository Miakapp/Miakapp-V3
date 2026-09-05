import { isDeepStrictEqual } from 'node:util';

import {
  PROBE_PRINCIPAL,
  PUBLIC_PRINCIPAL,
  normalizeEdgeFunction,
  normalizeEdgeInventory,
  policyForPublicInvoker,
} from './inventory.mjs';
import {
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  FUNCTION_NAME,
  PROJECT_ID,
  RUN_SERVICE_NAME,
  runtimeJson,
} from './runtime.mjs';

const FUNCTION_ENDPOINT = `https://cloudfunctions.googleapis.com/v2/${FUNCTION_NAME}`;
const RUN_ENDPOINT = `https://run.googleapis.com/v2/${RUN_SERVICE_NAME}`;
const OPERATION_NAME = new RegExp(
  `^projects/${PROJECT_ID}/locations/europe-west9/operations/[A-Za-z0-9_-]+$`,
  'u',
);
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const OPERATION_ATTEMPTS = 150;
const OPERATION_POLL_MILLISECONDS = 2_000;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function validateSession(session) {
  if (!plainObject(session)
    || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20
    || session.accessToken.length > 16 * 1024
    || /\s/u.test(session.accessToken)) {
    reject('Browser-relay edge access requires a verified ephemeral operator session');
  }
  return session;
}

async function readResponse(response, description) {
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return reject(`${description} response is unreadable`);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    reject(`${description} response size is invalid`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
  if (response.status !== 200) reject(`${description} returned an unexpected status`);
  return value;
}

async function requestJson(session, fetchImplementation, url, options, description) {
  validateSession(session);
  let response;
  try {
    response = await fetchImplementation(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Goog-User-Project': PROJECT_ID,
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json; charset=utf-8' }),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return reject(`${description} request outcome is unknown`);
  }
  return readResponse(response, description);
}

function environmentVariables(profile) {
  return Object.freeze({
    LOG_EXECUTION_ID: 'true',
    MIAKAPP_DEPLOYMENT_COMMIT: DEPLOYED_REPOSITORY_COMMIT,
    MIAKAPP_RUNTIME_CONFIG_JSON: runtimeJson(profile),
    MIAKAPP_SOURCE_ARCHIVE_SHA256: DEPLOYED_SOURCE_SHA256,
  });
}

export function buildFunctionProfilePatch(profile) {
  return Object.freeze({
    url: `${FUNCTION_ENDPOINT}?updateMask=serviceConfig.environmentVariables`,
    method: 'PATCH',
    body: JSON.stringify({
      name: FUNCTION_NAME,
      serviceConfig: { environmentVariables: environmentVariables(profile) },
    }),
  });
}

export function buildFunctionIngressPatch(ingress) {
  if (!['ALLOW_INTERNAL_ONLY', 'ALLOW_ALL'].includes(ingress)) {
    reject('Browser-relay edge ingress target is invalid');
  }
  return Object.freeze({
    url: `${FUNCTION_ENDPOINT}?updateMask=serviceConfig.ingressSettings`,
    method: 'PATCH',
    body: JSON.stringify({
      name: FUNCTION_NAME,
      serviceConfig: { ingressSettings: ingress },
    }),
  });
}

export function buildIamPatch(policy, enabled) {
  const next = policyForPublicInvoker(policy, enabled);
  return Object.freeze({
    url: `${RUN_ENDPOINT}:setIamPolicy`,
    method: 'POST',
    body: JSON.stringify({ policy: next, updateMask: 'bindings,etag' }),
    expected_members: Object.freeze(enabled
      ? [PUBLIC_PRINCIPAL, PROBE_PRINCIPAL].sort()
      : [PROBE_PRINCIPAL]),
  });
}

async function waitForOperation(session, fetchImplementation, sleep, operation) {
  if (!plainObject(operation) || !OPERATION_NAME.test(operation.name ?? '')) {
    reject('Cloud Function patch did not return the reviewed regional operation');
  }
  let current = operation;
  for (let attempt = 0; attempt < OPERATION_ATTEMPTS; attempt += 1) {
    if (current.done === true) {
      if (current.error !== undefined || !plainObject(current.response)) {
        reject('Cloud Function patch operation did not complete successfully');
      }
      return current.response;
    }
    await sleep(OPERATION_POLL_MILLISECONDS);
    current = await requestJson(
      session,
      fetchImplementation,
      `https://cloudfunctions.googleapis.com/v2/${current.name}`,
      { method: 'GET' },
      'Cloud Function patch operation',
    );
  }
  return reject('Cloud Function patch operation exceeded its bounded polling window');
}

export function createGoogleEdgeClient(session, options = {}) {
  validateSession(session);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  if (typeof fetchImplementation !== 'function' || typeof sleep !== 'function') {
    reject('Browser-relay edge client requires HTTP and bounded-wait implementations');
  }

  async function rawFunction() {
    return requestJson(
      session,
      fetchImplementation,
      FUNCTION_ENDPOINT,
      { method: 'GET' },
      'Cloud Function edge inventory',
    );
  }

  async function rawPolicy() {
    return requestJson(
      session,
      fetchImplementation,
      `${RUN_ENDPOINT}:getIamPolicy?options.requestedPolicyVersion=3`,
      { method: 'GET' },
      'Cloud Run edge IAM inventory',
    );
  }

  async function observeFunction() {
    return normalizeEdgeFunction(await rawFunction());
  }

  async function observeCombined() {
    const [functionValue, policyValue] = await Promise.all([rawFunction(), rawPolicy()]);
    return normalizeEdgeInventory(functionValue, policyValue);
  }

  async function requireExpected(expected) {
    const current = await observeCombined();
    if (!isDeepStrictEqual(current, expected)) {
      reject('Live edge inventory changed after the preceding guarded observation');
    }
    return current;
  }

  async function patchFunction(expected, request, description) {
    await requireExpected(expected);
    const operation = await requestJson(
      session,
      fetchImplementation,
      request.url,
      { method: request.method, body: request.body },
      description,
    );
    await waitForOperation(session, fetchImplementation, sleep, operation);
    return observeCombined();
  }

  return Object.freeze({
    observe: observeCombined,
    async setRuntimeProfile(expected, profile) {
      return patchFunction(
        expected,
        buildFunctionProfilePatch(profile),
        'Cloud Function edge runtime-profile patch',
      );
    },
    async setIngress(expected, ingress) {
      return patchFunction(
        expected,
        buildFunctionIngressPatch(ingress),
        'Cloud Function edge ingress patch',
      );
    },
    async setPublicInvoker(expected, enabled) {
      await requireExpected(expected);
      const request = buildIamPatch(expected.iam, enabled);
      await requestJson(
        session,
        fetchImplementation,
        request.url,
        { method: request.method, body: request.body },
        'Cloud Run edge IAM patch',
      );
      const current = await observeCombined();
      if (!isDeepStrictEqual(current.iam.bindings[0].members, request.expected_members)) {
        reject('Cloud Run edge IAM patch did not converge to the reviewed principals');
      }
      return current;
    },
    async closeIngress() {
      const before = await observeFunction();
      if (before.ingress === 'ALLOW_INTERNAL_ONLY') return before;
      const request = buildFunctionIngressPatch('ALLOW_INTERNAL_ONLY');
      const operation = await requestJson(
        session,
        fetchImplementation,
        request.url,
        { method: request.method, body: request.body },
        'Cloud Function emergency private-ingress patch',
      );
      await waitForOperation(session, fetchImplementation, sleep, operation);
      const after = await observeFunction();
      if (after.ingress !== 'ALLOW_INTERNAL_ONLY'
        || after.deployed_repository_commit !== before.deployed_repository_commit
        || after.source_archive_sha256 !== before.source_archive_sha256
        || after.copied_source_generation !== before.copied_source_generation) {
        reject('Cloud Function emergency private-ingress patch did not converge safely');
      }
      return after;
    },
  });
}
