import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  CANONICAL_RUNTIME_SHA256,
  CONTROL_PLANE_URI,
  DEPLOYED_REPOSITORY_COMMIT,
  DEPLOYED_SOURCE_SHA256,
  EDGE_PROFILE,
  FUNCTION_NAME,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  RUN_SERVICE_NAME,
  runtimeDigest,
  runtimeProfile,
} from './runtime.mjs';

export const PROBE_PRINCIPAL =
  'serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com';
export const PUBLIC_PRINCIPAL = 'allUsers';
export const INVOKER_ROLE = 'roles/run.invoker';

const REVISION = /^control-plane-[0-9]{5}-[a-z]{3}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const ETAG = /^[A-Za-z0-9+/]+={0,2}$/u;
const EXPECTED_LABELS = Object.freeze({
  environment: 'staging',
  'goog-terraform-provisioned': 'true',
  'managed-by': 'terraform',
  product: 'miakapp-v4',
});
const EXPECTED_ENVIRONMENT_KEYS = Object.freeze([
  'LOG_EXECUTION_ID',
  'MIAKAPP_DEPLOYMENT_COMMIT',
  'MIAKAPP_RUNTIME_CONFIG_JSON',
  'MIAKAPP_SOURCE_ARCHIVE_SHA256',
]);

export class StagingBrowserRelayEdgeInventoryError extends Error {
  constructor(message = 'Staging browser-relay edge inventory is invalid') {
    super(message);
    this.name = 'StagingBrowserRelayEdgeInventoryError';
  }
}

function reject(message) {
  throw new StagingBrowserRelayEdgeInventoryError(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function timestamp(value, description) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    reject(`${description} is not a canonical Cloud timestamp`);
  }
  return value;
}

export function normalizeEdgeFunction(value) {
  const service = value?.serviceConfig;
  const build = value?.buildConfig;
  const environment = service?.environmentVariables;
  if (!plainObject(value)
    || value.name !== FUNCTION_NAME
    || value.state !== 'ACTIVE'
    || value.environment !== 'GEN_2'
    || value.description !== 'Private Miakapp V4 staging control plane.'
    || !isDeepStrictEqual(value.labels, EXPECTED_LABELS)
    || !plainObject(build)
    || build.runtime !== 'nodejs22'
    || build.entryPoint !== 'controlPlane'
    || build.dockerRepository
      !== `projects/${PROJECT_ID}/locations/${REGION}/repositories/miakapp-control-plane`
    || build.serviceAccount
      !== `projects/${PROJECT_ID}/serviceAccounts/miakapp-control-build@${PROJECT_ID}.iam.gserviceaccount.com`
    || build?.source?.storageSource?.bucket
      !== `gcf-v2-sources-${PROJECT_NUMBER}-${REGION}`
    || build?.source?.storageSource?.object !== 'control-plane/function-source.zip'
    || !/^[1-9][0-9]*$/u.test(build?.source?.storageSource?.generation ?? '')
    || !plainObject(service)
    || service.service !== RUN_SERVICE_NAME
    || service.uri !== CONTROL_PLANE_URI
    || !REVISION.test(service.revision ?? '')
    || !['ALLOW_INTERNAL_ONLY', 'ALLOW_ALL'].includes(service.ingressSettings)
    || (service.minInstanceCount ?? 0) !== 0
    || service.maxInstanceCount !== 1
    || service.maxInstanceRequestConcurrency !== 16
    || service.timeoutSeconds !== 30
    || service.availableMemory !== '256M'
    || service.availableCpu !== '1'
    || service.allTrafficOnLatestRevision !== true
    || service.serviceAccountEmail !== `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`
    || !plainObject(environment)
    || !isDeepStrictEqual(Object.keys(environment).sort(), [...EXPECTED_ENVIRONMENT_KEYS].sort())
    || environment.LOG_EXECUTION_ID !== 'true'
    || environment.MIAKAPP_DEPLOYMENT_COMMIT !== DEPLOYED_REPOSITORY_COMMIT
    || environment.MIAKAPP_SOURCE_ARCHIVE_SHA256 !== DEPLOYED_SOURCE_SHA256) {
    reject('Cloud Function differs from the reviewed staging edge boundary');
  }
  const profile = runtimeProfile(environment.MIAKAPP_RUNTIME_CONFIG_JSON);
  return Object.freeze({
    name: value.name,
    state: value.state,
    revision: service.revision,
    update_time: timestamp(value.updateTime, 'Cloud Function update time'),
    service: service.service,
    uri: service.uri,
    ingress: service.ingressSettings,
    runtime_profile: profile,
    runtime_config_sha256: runtimeDigest(profile),
    deployed_repository_commit: environment.MIAKAPP_DEPLOYMENT_COMMIT,
    source_archive_sha256: environment.MIAKAPP_SOURCE_ARCHIVE_SHA256,
    copied_source_generation: build.source.storageSource.generation,
    minimum_instances: service.minInstanceCount ?? 0,
    maximum_instances: service.maxInstanceCount,
    concurrency: service.maxInstanceRequestConcurrency,
    timeout_seconds: service.timeoutSeconds,
  });
}

export function normalizeEdgePolicy(value) {
  if (!plainObject(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), ['bindings', 'etag', 'version'])
    || value.version !== 1
    || typeof value.etag !== 'string'
    || !ETAG.test(value.etag)
    || !Array.isArray(value.bindings)
    || value.bindings.length !== 1) {
    reject('Cloud Run IAM policy differs from the reviewed staging edge boundary');
  }
  const binding = value.bindings[0];
  if (!plainObject(binding)
    || !isDeepStrictEqual(Object.keys(binding).sort(), ['members', 'role'])
    || binding.role !== INVOKER_ROLE
    || !Array.isArray(binding.members)) {
    reject('Cloud Run invoker binding differs from the reviewed staging edge boundary');
  }
  const members = [...binding.members].sort();
  const privateMembers = [PROBE_PRINCIPAL];
  const publicMembers = [PUBLIC_PRINCIPAL, PROBE_PRINCIPAL].sort();
  if (!isDeepStrictEqual(members, privateMembers)
    && !isDeepStrictEqual(members, publicMembers)) {
    reject('Cloud Run invoker principals differ from the reviewed staging edge boundary');
  }
  return Object.freeze({
    resource: RUN_SERVICE_NAME,
    version: value.version,
    etag: value.etag,
    bindings: Object.freeze([Object.freeze({
      role: INVOKER_ROLE,
      members: Object.freeze(members),
    })]),
    unauthenticated_invokers: members.includes(PUBLIC_PRINCIPAL) ? 1 : 0,
  });
}

export function classifyEdgeInventory(value) {
  const profile = value.function.runtime_profile;
  const ingress = value.function.ingress;
  const publicInvoker = value.iam.unauthenticated_invokers === 1;
  if (profile === 'canonical' && ingress === 'ALLOW_INTERNAL_ONLY' && !publicInvoker) {
    return 'canonical_private';
  }
  if (profile === EDGE_PROFILE && ingress === 'ALLOW_INTERNAL_ONLY' && !publicInvoker) {
    return 'edge_private';
  }
  if (profile === EDGE_PROFILE && ingress === 'ALLOW_ALL' && !publicInvoker) {
    return 'edge_ingress_ready';
  }
  if (profile === EDGE_PROFILE && ingress === 'ALLOW_ALL' && publicInvoker) {
    return 'edge_public';
  }
  return 'recoverable_partial';
}

export function normalizeEdgeInventory(functionValue, policyValue) {
  const normalized = {
    schema: 'miakapp.staging-browser-relay-edge-inventory/1',
    project_id: PROJECT_ID,
    region: REGION,
    function: normalizeEdgeFunction(functionValue),
    iam: normalizeEdgePolicy(policyValue),
  };
  return Object.freeze({
    ...normalized,
    state: classifyEdgeInventory(normalized),
  });
}

export function validateCanonicalPrivateInventory(value) {
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-browser-relay-edge-inventory/1'
    || value.project_id !== PROJECT_ID
    || value.region !== REGION
    || value.state !== 'canonical_private'
    || value.function?.runtime_config_sha256 !== CANONICAL_RUNTIME_SHA256
    || value.function?.ingress !== 'ALLOW_INTERNAL_ONLY'
    || value.iam?.unauthenticated_invokers !== 0) {
    reject('Control plane is not the exact canonical private edge baseline');
  }
  return value;
}

export function validateEdgeInventoryState(value, expectedState) {
  if (![
    'canonical_private',
    'edge_private',
    'edge_ingress_ready',
    'edge_public',
    'recoverable_partial',
  ].includes(expectedState) || value?.state !== expectedState) {
    reject(`Control plane did not converge to ${expectedState}`);
  }
  return value;
}

export function sameStaticBoundary(value, baseline) {
  validateCanonicalPrivateInventory(baseline);
  if (!plainObject(value)
    || value.schema !== baseline.schema
    || value.project_id !== baseline.project_id
    || value.region !== baseline.region
    || value.function?.name !== baseline.function.name
    || value.function?.service !== baseline.function.service
    || value.function?.uri !== baseline.function.uri
    || value.function?.deployed_repository_commit
      !== baseline.function.deployed_repository_commit
    || value.function?.source_archive_sha256 !== baseline.function.source_archive_sha256
    || value.function?.copied_source_generation !== baseline.function.copied_source_generation
    || value.function?.minimum_instances !== 0
    || value.function?.maximum_instances !== 1
    || value.function?.concurrency !== 16
    || value.function?.timeout_seconds !== 30
    || value.iam?.resource !== baseline.iam.resource
    || value.iam?.version !== 1) {
    reject('Control-plane static edge boundary changed during the bounded window');
  }
  return true;
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function inventorySha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function policyForPublicInvoker(policy, enabled) {
  const normalized = normalizeEdgePolicy({
    version: policy.version,
    etag: policy.etag,
    bindings: policy.bindings.map((binding) => ({
      role: binding.role,
      members: [...binding.members],
    })),
  });
  const members = new Set(normalized.bindings[0].members);
  if (enabled) members.add(PUBLIC_PRINCIPAL);
  else members.delete(PUBLIC_PRINCIPAL);
  members.add(PROBE_PRINCIPAL);
  return Object.freeze({
    version: 1,
    etag: normalized.etag,
    bindings: Object.freeze([Object.freeze({
      role: INVOKER_ROLE,
      members: Object.freeze([...members].sort()),
    })]),
  });
}
