import { isDeepStrictEqual } from 'node:util';

import {
  MONITORING_PREFLIGHT_RESULT_SHA256,
} from '../browser-relay-monitoring/contract.mjs';
import {
  ROLLBACK_PREFLIGHT_RESULT_SHA256,
} from '../browser-relay-rollback/contract.mjs';
import { observeRollbackPreflight } from '../browser-relay-rollback/cloud.mjs';
import {
  BROWSER_RELAY_PLAN_SHA256,
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_PREFLIGHT_RESULT_SCHEMA,
  ORCHESTRATOR_PROFILE_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  validateBrowserRelayOrchestratorProfile,
  validateOrchestratorPreflightResultValue,
} from './contract.mjs';
import {
  observeOrchestratorClaimAbsent,
  orchestratorClaimAbsence,
} from './claim.mjs';

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
    reject('Orchestrator preflight requires a verified ephemeral operator session');
  }
  return value;
}

function validateCommit(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    reject('Orchestrator preflight requires the exact merged implementation commit');
  }
  return value;
}

function validateClock(value) {
  if (typeof value !== 'function') reject('Orchestrator preflight clock is invalid');
  const instant = value();
  if (!Number.isSafeInteger(instant) || instant < 0) {
    reject('Orchestrator preflight clock returned an invalid instant');
  }
  return instant;
}

export function buildOrchestratorPreflightResult({ implementationCommit, claim, rollback }) {
  validateBrowserRelayOrchestratorProfile();
  validateCommit(implementationCommit);
  if (!isDeepStrictEqual(claim, orchestratorClaimAbsence())) {
    reject('Orchestrator preflight requires the exact absent global claim');
  }
  if (!plainObject(rollback)
    || rollback.state !== 'rollback_target_preflighted_private_and_converged'
    || rollback.cloud_mutations !== 0
    || rollback.public_ingress_changes !== 0
    || rollback.acceptance_executions !== 0) {
    reject('Orchestrator preflight requires the exact closed rollback observation');
  }
  return validateOrchestratorPreflightResultValue({
    schema: ORCHESTRATOR_PREFLIGHT_RESULT_SCHEMA,
    state: 'single_use_edge_orchestrator_preflight_succeeded_private_and_unclaimed',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: rollback.observed_at,
    implementation_commit: implementationCommit,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    browser_relay_plan_sha256: BROWSER_RELAY_PLAN_SHA256,
    claim_bucket: ORCHESTRATOR_CLAIM_BUCKET,
    claim_object: ORCHESTRATOR_CLAIM_OBJECT,
    claim_state: claim.state,
    control_plane_state: rollback.control_plane_state,
    control_plane_revision: rollback.control_plane_revision,
    control_plane_ingress: rollback.control_plane_ingress,
    control_plane_public_invokers: rollback.control_plane_public_invokers,
    relay_phase: rollback.relay_phase,
    relay_services: rollback.relay_services,
    relay_public_invokers: rollback.relay_public_invokers,
    relay_service_account_user_managed_keys:
      rollback.relay_service_account_user_managed_keys,
    relay_inventory_sha256: rollback.relay_inventory_sha256,
    runner_route_present: rollback.runner_route_present,
    runner_route_status: rollback.runner_route_status,
    firebase_auth_users: rollback.firebase_auth_users,
    application_fixture_collections: rollback.application_fixture_collections,
    temporary_iam_bindings: rollback.temporary_iam_bindings,
    minimum_instances: rollback.minimum_instances,
    terraform_convergence: rollback.terraform_convergence,
    terraform_managed_resource_noops: rollback.terraform_managed_resource_noops,
    monitoring_preflight_result_sha256: MONITORING_PREFLIGHT_RESULT_SHA256,
    rollback_preflight_result_sha256: ROLLBACK_PREFLIGHT_RESULT_SHA256,
    cloud_mutations: 0,
    public_ingress_changes: 0,
    acceptance_executions: 0,
    credential_material_retained: false,
    raw_cloud_responses_retained: false,
    terraform_plan_retained: false,
  });
}

export async function observeOrchestratorPreflight(sessionValue, options = {}) {
  const session = validateSession(sessionValue);
  validateBrowserRelayOrchestratorProfile();
  const allowedOptions = [
    'applicationDataObserver',
    'claimObserver',
    'clock',
    'fetchImplementation',
    'hostingObserver',
    'iamObserver',
    'implementationCommit',
    'privateBoundaryObserver',
    'rollbackObserver',
    'terraformPlan',
  ];
  if (!plainObject(options)
    || Object.keys(options).some((key) => !allowedOptions.includes(key))) {
    reject('Orchestrator preflight options exceed the reviewed boundary');
  }
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const claimObserver = options.claimObserver ?? observeOrchestratorClaimAbsent;
  const rollbackObserver = options.rollbackObserver ?? observeRollbackPreflight;
  const implementationCommit = validateCommit(options.implementationCommit);
  const instant = validateClock(options.clock ?? Date.now);
  if (typeof fetchImplementation !== 'function'
    || typeof claimObserver !== 'function'
    || typeof rollbackObserver !== 'function') {
    reject('Orchestrator preflight observers are invalid');
  }
  const [claim, rollback] = await Promise.all([
    claimObserver(session, fetchImplementation),
    rollbackObserver(session, {
      fetchImplementation,
      clock: () => instant,
      implementationCommit,
      terraformPlan: options.terraformPlan,
      ...(options.privateBoundaryObserver === undefined
        ? {} : { privateBoundaryObserver: options.privateBoundaryObserver }),
      ...(options.hostingObserver === undefined
        ? {} : { hostingObserver: options.hostingObserver }),
      ...(options.applicationDataObserver === undefined
        ? {} : { applicationDataObserver: options.applicationDataObserver }),
      ...(options.iamObserver === undefined
        ? {} : { iamObserver: options.iamObserver }),
    }),
  ]);
  if (rollback?.observed_at !== new Date(instant).toISOString()) {
    reject('Orchestrator preflight rollback observation is not from the same instant');
  }
  return buildOrchestratorPreflightResult({ implementationCommit, claim, rollback });
}
