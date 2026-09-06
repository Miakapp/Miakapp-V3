import { isDeepStrictEqual } from 'node:util';

import {
  ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
  ORCHESTRATOR_PROFILE_SHA256,
  validateOrchestratorPreflightResultValue,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  observeOrchestratorPreflight,
} from '../browser-relay-orchestrator/preflight.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  OPERATION_PREFLIGHT_RESULT_SCHEMA,
  OPERATION_PROFILE_SHA256,
  OPERATION_SOURCE_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  validateBrowserRelayOperationProfile,
  validateOperationPreflightResultValue,
} from './contract.mjs';

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateSession(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value), ['accessToken'])
    || typeof value.accessToken !== 'string'
    || value.accessToken.length < 20
    || value.accessToken.length > 16 * 1024
    || /\s/u.test(value.accessToken)) {
    reject('Operation preflight requires a verified ephemeral operator session');
  }
  return value;
}

function validateCommit(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    reject('Operation preflight requires the exact merged implementation commit');
  }
  return value;
}

export function buildOperationPreflightResult({ implementationCommit, orchestrator }) {
  validateBrowserRelayOperationProfile();
  validateCommit(implementationCommit);
  let observation;
  try {
    observation = validateOrchestratorPreflightResultValue(orchestrator);
  } catch {
    reject('Operation preflight requires one fresh closed orchestrator observation');
  }
  if (observation.state
      !== 'single_use_edge_orchestrator_preflight_succeeded_private_and_unclaimed'
    || observation.implementation_commit !== implementationCommit
    || observation.claim_state !== 'absent'
    || observation.control_plane_state !== 'canonical_private'
    || observation.relay_phase !== 'private_ready'
    || observation.runner_route_present !== false
    || observation.firebase_auth_users !== 0
    || observation.application_fixture_collections !== 0
    || observation.temporary_iam_bindings !== 0
    || observation.minimum_instances !== 0
    || observation.terraform_convergence !== 'no_changes'
    || observation.cloud_mutations !== 0
    || observation.public_ingress_changes !== 0
    || observation.acceptance_executions !== 0) {
    reject('Operation preflight requires one fresh closed orchestrator observation');
  }
  return validateOperationPreflightResultValue({
    schema: OPERATION_PREFLIGHT_RESULT_SCHEMA,
    state: 'single_use_live_operation_preflight_succeeded_private_and_unclaimed',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: observation.observed_at,
    implementation_commit: implementationCommit,
    profile_sha256: OPERATION_PROFILE_SHA256,
    operation_source_sha256: OPERATION_SOURCE_SHA256,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    orchestrator_profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    orchestrator_preflight_result_sha256: ORCHESTRATOR_PREFLIGHT_RESULT_SHA256,
    claim_bucket: observation.claim_bucket,
    claim_object: observation.claim_object,
    claim_state: observation.claim_state,
    control_plane_state: observation.control_plane_state,
    control_plane_revision: observation.control_plane_revision,
    control_plane_ingress: observation.control_plane_ingress,
    control_plane_public_invokers: observation.control_plane_public_invokers,
    relay_phase: observation.relay_phase,
    relay_services: observation.relay_services,
    relay_public_invokers: observation.relay_public_invokers,
    relay_service_account_user_managed_keys:
      observation.relay_service_account_user_managed_keys,
    relay_inventory_sha256: observation.relay_inventory_sha256,
    runner_route_present: observation.runner_route_present,
    runner_route_status: observation.runner_route_status,
    firebase_auth_users: observation.firebase_auth_users,
    application_fixture_collections: observation.application_fixture_collections,
    temporary_iam_bindings: observation.temporary_iam_bindings,
    minimum_instances: observation.minimum_instances,
    terraform_convergence: observation.terraform_convergence,
    terraform_managed_resource_noops: observation.terraform_managed_resource_noops,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credential_material_retained: false,
    raw_cloud_responses_retained: false,
    terraform_plan_retained: false,
  });
}

export async function observeOperationPreflight(sessionValue, options = {}) {
  const session = validateSession(sessionValue);
  validateBrowserRelayOperationProfile();
  const allowedOptions = [
    'applicationDataObserver',
    'claimObserver',
    'clock',
    'fetchImplementation',
    'hostingObserver',
    'iamObserver',
    'implementationCommit',
    'orchestratorObserver',
    'privateBoundaryObserver',
    'rollbackObserver',
    'terraformPlan',
  ];
  if (!plainObject(options)
    || Object.keys(options).some((key) => !allowedOptions.includes(key))) {
    reject('Operation preflight options exceed the reviewed read-only boundary');
  }
  const implementationCommit = validateCommit(options.implementationCommit);
  const orchestratorObserver = options.orchestratorObserver ?? observeOrchestratorPreflight;
  if (typeof orchestratorObserver !== 'function') {
    reject('Operation preflight orchestrator observer is invalid');
  }
  const orchestrator = await orchestratorObserver(session, {
    implementationCommit,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.fetchImplementation === undefined
      ? {} : { fetchImplementation: options.fetchImplementation }),
    ...(options.claimObserver === undefined ? {} : { claimObserver: options.claimObserver }),
    ...(options.rollbackObserver === undefined
      ? {} : { rollbackObserver: options.rollbackObserver }),
    ...(options.privateBoundaryObserver === undefined
      ? {} : { privateBoundaryObserver: options.privateBoundaryObserver }),
    ...(options.hostingObserver === undefined
      ? {} : { hostingObserver: options.hostingObserver }),
    ...(options.applicationDataObserver === undefined
      ? {} : { applicationDataObserver: options.applicationDataObserver }),
    ...(options.iamObserver === undefined ? {} : { iamObserver: options.iamObserver }),
    ...(options.terraformPlan === undefined ? {} : { terraformPlan: options.terraformPlan }),
  });
  return buildOperationPreflightResult({ implementationCommit, orchestrator });
}
