import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';

import {
  PROBE_PRINCIPAL,
  normalizeEdgeInventory,
} from '../browser-relay-edge/inventory.mjs';
import {
  CONTROL_PLANE_URI,
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EDGE_PROFILE,
  FUNCTION_NAME,
  RUN_SERVICE_NAME,
  runtimeJson,
} from '../browser-relay-edge/runtime.mjs';
import {
  ORCHESTRATOR_CLAIM_BUCKET,
  ORCHESTRATOR_CLAIM_OBJECT,
  ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
  ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
  ORCHESTRATOR_PROFILE_SHA256,
  canonicalJson as orchestratorCanonicalJson,
  sha256 as orchestratorSha256,
} from '../browser-relay-orchestrator/contract.mjs';
import {
  buildOrchestratorClaim,
  orchestratorClaimAbsence,
} from '../browser-relay-orchestrator/claim.mjs';
import {
  TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS,
  rejectTrustedProviderOwner,
} from './contract.mjs';

const UPDATE_TIMES = Object.freeze([
  '2026-09-05T19:48:55.366699112Z',
  '2026-09-06T10:00:01.000000001Z',
  '2026-09-06T10:00:02.000000001Z',
  '2026-09-06T10:00:03.000000001Z',
  '2026-09-06T10:00:04.000000001Z',
]);
const EXPECTED_CALL_ORDER = Object.freeze([
  'validateAuthorization',
  'observeClaimAbsent',
  'acquireClaim',
  'observeWindowBaseline',
  'createSyntheticFixture',
  'publishRunner',
  'verifyRunner',
  'sampleMonitoring:before_matrix',
  'openRelaysPublic',
  'sampleMonitoring:after_matrix',
  'removeRunner',
  'stopSessions',
  'closeRelaysPrivateReady',
  'verifyWindowCleanup',
  'removeSyntheticFixture',
  'removeTemporaryBindings',
  'verifyFinalCleanup',
]);

function reject() {
  return rejectTrustedProviderOwner();
}

function exactInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Object.isFrozen(value)
    || !isDeepStrictEqual(Object.keys(value), ['authority'])
    || value.authority === null || typeof value.authority !== 'object') reject();
  return value;
}

function functionFixture(options = {}) {
  const profile = options.profile ?? 'canonical';
  const ingress = options.ingress ?? 'ALLOW_INTERNAL_ONLY';
  const revision = options.revision ?? 'control-plane-00010-vop';
  const updateTime = options.updateTime ?? UPDATE_TIMES[0];
  return {
    name: FUNCTION_NAME,
    state: 'ACTIVE',
    environment: 'GEN_2',
    description: 'Private Miakapp V4 staging control plane.',
    labels: {
      environment: 'staging',
      'goog-terraform-provisioned': 'true',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
    },
    buildConfig: {
      runtime: 'nodejs22',
      entryPoint: 'controlPlane',
      dockerRepository:
        'projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane',
      serviceAccount:
        'projects/miakapp-v4-staging/serviceAccounts/miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com',
      source: {
        storageSource: {
          bucket: 'gcf-v2-sources-1072737219170-europe-west9',
          object: 'control-plane/function-source.zip',
          generation: '1788637681094791',
        },
      },
    },
    serviceConfig: {
      service: RUN_SERVICE_NAME,
      uri: CONTROL_PLANE_URI,
      revision,
      ingressSettings: ingress,
      maxInstanceCount: 1,
      maxInstanceRequestConcurrency: 16,
      timeoutSeconds: 30,
      availableMemory: '256M',
      availableCpu: '1',
      allTrafficOnLatestRevision: true,
      serviceAccountEmail:
        'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      environmentVariables: {
        LOG_EXECUTION_ID: 'true',
        MIAKAPP_DEPLOYMENT_COMMIT: DEPLOYED_REPOSITORY_COMMIT,
        MIAKAPP_RUNTIME_CONFIG_JSON: runtimeJson(profile),
        MIAKAPP_SOURCE_ARCHIVE_SHA256: DEPLOYED_SOURCE_SHA256,
      },
    },
    updateTime,
  };
}

function policyFixture(publicInvoker = false, etag = 'BwZanS3TQAE=') {
  return {
    version: 1,
    etag,
    bindings: [{
      role: 'roles/run.invoker',
      members: publicInvoker ? ['allUsers', PROBE_PRINCIPAL] : [PROBE_PRINCIPAL],
    }],
  };
}

function inventory(options = {}) {
  return normalizeEdgeInventory(
    functionFixture(options),
    policyFixture(options.publicInvoker, options.etag),
  );
}

function nextInventory(value, change = {}) {
  const profile = change.profile ?? value.function.runtime_profile;
  const ingress = change.ingress ?? value.function.ingress;
  const publicInvoker = change.publicInvoker ?? value.iam.unauthenticated_invokers === 1;
  const revisionNumber = Number(value.function.revision.slice(14, 19)) + 1;
  return inventory({
    profile,
    ingress,
    publicInvoker,
    revision: change.functionChanged === false
      ? value.function.revision
      : `control-plane-${String(revisionNumber).padStart(5, '0')}-opr`,
    updateTime: change.functionChanged === false
      ? value.function.update_time
      : UPDATE_TIMES[Math.min(revisionNumber - 10, UPDATE_TIMES.length - 1)],
    etag: change.iamChanged
      ? (value.iam.etag === 'BwZanS3TQAE=' ? 'BwZanS3TQAI=' : 'BwZanS3TQAM=')
      : value.iam.etag,
  });
}

function createEdgeClient() {
  let current = inventory();
  return Object.freeze({
    async observe() {
      return current;
    },
    async setRuntimeProfile(expected, profile) {
      if (expected !== current || !['canonical', EDGE_PROFILE].includes(profile)) reject();
      current = nextInventory(current, { profile });
      return current;
    },
    async setIngress(expected, ingress) {
      if (expected !== current || !['ALLOW_INTERNAL_ONLY', 'ALLOW_ALL'].includes(ingress)) {
        reject();
      }
      current = nextInventory(current, { ingress });
      return current;
    },
    async setPublicInvoker(expected, enabled) {
      if (expected !== current || typeof enabled !== 'boolean') reject();
      current = nextInventory(current, {
        publicInvoker: enabled,
        functionChanged: false,
        iamChanged: true,
      });
      return current;
    },
    async closeIngress() {
      if (current.function.ingress === 'ALLOW_ALL') {
        current = nextInventory(current, { ingress: 'ALLOW_INTERNAL_ONLY' });
      }
      return current.function;
    },
  });
}

function claimReceipt(attemptedAt) {
  const claim = buildOrchestratorClaim(attemptedAt);
  const bytes = Buffer.from(orchestratorCanonicalJson(claim), 'utf8');
  return Object.freeze({
    schema: ORCHESTRATOR_CLAIM_RECEIPT_SCHEMA,
    bucket: ORCHESTRATOR_CLAIM_BUCKET,
    object: ORCHESTRATOR_CLAIM_OBJECT,
    generation: '1788660000000001',
    size_bytes: bytes.byteLength,
    sha256: orchestratorSha256(bytes),
    repository_commit: ORCHESTRATOR_IMPLEMENTATION_BASE_COMMIT,
    profile_sha256: ORCHESTRATOR_PROFILE_SHA256,
    browser_relay_plan_sha256: claim.browser_relay_plan_sha256,
    attempted_at: claim.attempted_at,
    expires_at: claim.expires_at,
    retry_authorized: false,
    deletion_authorized: false,
    raw_contents_committed: false,
  });
}

function windowBaseline() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-operation-window-baseline/1',
    state: 'edge_public_pristine',
    control_plane_public_invokers: 1,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    firebase_auth_users: 0,
    application_fixture_collections: 0,
    temporary_iam_bindings: 0,
    current_signing_key_version: 1,
    published_signing_key_versions: Object.freeze([1, 2]),
  });
}

function windowCleanup() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-operation-window-cleanup/1',
    state: 'edge_public_window_clean',
    control_plane_public_invokers: 1,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    active_browser_sessions: 0,
    active_coordinator_sessions: 0,
  });
}

function finalCleanup() {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-operation-final-cleanup/1',
    state: 'canonical_private_fully_clean',
    control_plane_state: 'canonical_private',
    control_plane_public_invokers: 0,
    relay_phase: 'private_ready',
    relay_services: 2,
    relay_public_invokers: 0,
    runner_route_present: false,
    active_browser_sessions: 0,
    active_coordinator_sessions: 0,
    firebase_auth_users: 0,
    synthetic_homes: 0,
    application_fixture_collections: 0,
    temporary_iam_bindings: 0,
    minimum_instances: 0,
    terraform_convergence: 'no_changes',
  });
}

function monitoringSample(afterMatrix) {
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-monitoring-sample/1',
    phase: 'public_window',
    acceptance_executions: 1,
    browser_invocations: afterMatrix ? 3 : 0,
    cloud_builds: 0,
    control_plane_exchanges: afterMatrix ? 8 : 0,
    control_plane_public_instance_seconds: 600,
    credential_or_private_traffic_diagnostics: 0,
    firebase_or_app_check_tokens_on_websocket: 0,
    firestore_writes: afterMatrix ? 32 : 0,
    identity_or_audience_binding_failures: 0,
    kms_signatures: afterMatrix ? 8 : 0,
    maximum_instances_per_service: 1,
    persistent_iam_mutations: 0,
    projected_incremental_milli_eur: 100,
    public_window_seconds: 600,
    recaptcha_assessments: afterMatrix ? 8 : 0,
    relay_services: 2,
    rollback_precondition_failures: 0,
    total_relay_instance_seconds: 1200,
    unexpected_project_mutations: 0,
  });
}

export function createBrowserRelayTrustedProviderOperation(inputValue) {
  if (arguments.length !== 1) reject();
  const { authority } = exactInput(inputValue);
  let cursor = 0;
  let closed = false;

  function expect(name) {
    if (closed || EXPECTED_CALL_ORDER[cursor] !== name) reject();
    cursor += 1;
  }

  const components = Object.freeze({
    async validateAuthorization() {
      expect('validateAuthorization');
      return authority.activateOperation();
    },
    async observeClaimAbsent() {
      expect('observeClaimAbsent');
      return orchestratorClaimAbsence();
    },
    async acquireClaim(attemptedAt) {
      expect('acquireClaim');
      return claimReceipt(attemptedAt);
    },
    edgeClient: createEdgeClient(),
    async observeWindowBaseline() {
      expect('observeWindowBaseline');
      return windowBaseline();
    },
    async createSyntheticFixture() {
      expect('createSyntheticFixture');
      return true;
    },
    async publishRunner() {
      expect('publishRunner');
      return true;
    },
    async verifyRunner() {
      expect('verifyRunner');
      return true;
    },
    async sampleMonitoring(stage) {
      expect(`sampleMonitoring:${stage}`);
      return monitoringSample(stage === 'after_matrix');
    },
    async openRelaysPublic() {
      expect('openRelaysPublic');
      return true;
    },
    async removeRunner() {
      expect('removeRunner');
      return true;
    },
    async stopSessions() {
      expect('stopSessions');
      return true;
    },
    async closeRelaysPrivateReady() {
      expect('closeRelaysPrivateReady');
      return true;
    },
    async verifyWindowCleanup() {
      expect('verifyWindowCleanup');
      return windowCleanup();
    },
    async removeSyntheticFixture() {
      expect('removeSyntheticFixture');
      return true;
    },
    async removeTemporaryBindings() {
      expect('removeTemporaryBindings');
      return true;
    },
    async verifyFinalCleanup() {
      expect('verifyFinalCleanup');
      return finalCleanup();
    },
  });

  if (!isDeepStrictEqual(Object.keys(components).sort(),
    [...TRUSTED_PROVIDER_OWNER_OPERATION_FIELDS].sort())) reject();

  async function close() {
    if (arguments.length !== 0) reject();
    if (closed) return undefined;
    closed = true;
    cursor = undefined;
    return undefined;
  }

  return Object.freeze({ components, close });
}
