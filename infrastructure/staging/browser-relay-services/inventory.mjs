import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  BOOTSTRAP_CLAIM_OBJECT,
  PRIVATE_READY_CLAIM_OBJECT,
  PROJECT_ID,
  RECOVERY_CLAIM_OBJECT,
  REGION,
  STATE_BUCKET,
  STATE_OBJECT,
  TERRAFORM_VERSION,
  canonicalJson,
  sha256,
  validateRelayServicesProfile,
  validateRelayServicesV4Profile,
  validateRelayServicesV3Profile,
  validateRelayServicesV5Profile,
} from './contract.mjs';

const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function validateSession(session) {
  if (!plainObject(session) || typeof session.accessToken !== 'string'
    || session.accessToken.length < 20 || /\s/u.test(session.accessToken)) {
    reject('Relay-services inventory requires a verified operator session');
  }
  return session;
}

function validateFetch(fetchImplementation) {
  if (typeof fetchImplementation !== 'function') {
    reject('Relay-services inventory requires an HTTP transport');
  }
  return fetchImplementation;
}

function headers(accessToken, contentType = false) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    ...(contentType ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
  };
}

async function request(
  fetchImplementation,
  url,
  accessToken,
  {
    method = 'GET',
    body,
    description,
    allowedStatuses = [200],
    maximumBytes = MAXIMUM_JSON_BYTES,
    contentType = false,
  },
) {
  let response;
  try {
    response = await fetchImplementation(url, {
      method,
      headers: headers(accessToken, contentType),
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(30_000),
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
  if (!allowedStatuses.includes(response.status) || bytes.byteLength > maximumBytes) {
    reject(`${description} returned an unexpected response`);
  }
  return Object.freeze({ status: response.status, bytes });
}

function parseJson(bytes, description) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    reject(`${description} returned an empty response`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject(`${description} returned invalid JSON`);
  }
}

function serviceName(resourceName) {
  const prefix = `projects/${PROJECT_ID}/locations/${REGION}/services/`;
  if (typeof resourceName !== 'string' || !resourceName.startsWith(prefix)
    || resourceName.length === prefix.length) {
    reject('Cloud Run service inventory contains a foreign resource');
  }
  return resourceName.slice(prefix.length);
}

function normalizeBindings(policy, description) {
  if (!plainObject(policy)
    || (policy.bindings !== undefined && !Array.isArray(policy.bindings))) {
    reject(`${description} IAM policy is malformed`);
  }
  return (policy.bindings ?? []).map((binding) => {
    if (!plainObject(binding) || typeof binding.role !== 'string'
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== 'string')) {
      reject(`${description} IAM policy contains a malformed binding`);
    }
    return Object.freeze({
      role: binding.role,
      members: Object.freeze([...binding.members].sort()),
      ...(binding.condition === undefined ? {} : { condition: binding.condition }),
    });
  }).sort((left, right) => `${left.role}:${left.members.join(',')}`
    .localeCompare(`${right.role}:${right.members.join(',')}`));
}

function normalizeRelayService(service, policy, profile) {
  const name = serviceName(service.name);
  const reviewed = profile.services.find((candidate) => candidate.name === name);
  if (reviewed === undefined || !plainObject(service.template)
    || !Array.isArray(service.template.containers)
    || service.template.containers.length !== 1) {
    reject('Relay Cloud Run service inventory is malformed');
  }
  const container = service.template.containers[0];
  if (!plainObject(container)) reject('Relay container inventory is malformed');
  const environment = {};
  if (!Array.isArray(container.env)) reject('Relay environment inventory is missing');
  for (const entry of container.env) {
    if (!plainObject(entry) || typeof entry.name !== 'string'
      || typeof entry.value !== 'string' || entry.valueSource !== undefined
      || Object.hasOwn(environment, entry.name)) {
      reject('Relay environment inventory contains an invalid entry');
    }
    environment[entry.name] = entry.value;
  }
  const iamBindings = normalizeBindings(policy, name);
  return Object.freeze({
    id: reviewed.id,
    name,
    resource_name: service.name,
    uri: service.uri,
    generation: String(service.generation ?? ''),
    ingress: service.ingress,
    labels: Object.freeze({ ...(service.labels ?? {}) }),
    service_account: service.template.serviceAccount,
    execution_environment: service.template.executionEnvironment,
    minimum_instances: Number(service.template.scaling?.minInstanceCount ?? 0),
    maximum_instances: Number(service.template.scaling?.maxInstanceCount ?? 0),
    concurrency: Number(service.template.maxInstanceRequestConcurrency ?? 0),
    timeout: service.template.timeout,
    session_affinity: service.template.sessionAffinity ?? false,
    container: Object.freeze({
      name: container.name,
      image: container.image,
      environment: Object.freeze(environment),
      ports: Object.freeze((container.ports ?? []).map((port) => Object.freeze({
        name: port.name,
        container_port: Number(port.containerPort),
      }))),
      cpu: container.resources?.limits?.cpu,
      memory: container.resources?.limits?.memory,
      cpu_idle: container.resources?.cpuIdle ?? false,
      startup_cpu_boost: container.resources?.startupCpuBoost ?? false,
      startup_probe: Object.freeze({
        path: container.startupProbe?.httpGet?.path,
        port: Number(container.startupProbe?.httpGet?.port ?? 0),
        initial_delay_seconds: Number(container.startupProbe?.initialDelaySeconds ?? 0),
        timeout_seconds: Number(container.startupProbe?.timeoutSeconds ?? 0),
        period_seconds: Number(container.startupProbe?.periodSeconds ?? 0),
        failure_threshold: Number(container.startupProbe?.failureThreshold ?? 0),
      }),
    }),
    traffic: Object.freeze((service.traffic ?? []).map((entry) => Object.freeze({
      type: entry.type,
      percent: Number(entry.percent),
    }))),
    ready: service.terminalCondition?.state === 'CONDITION_SUCCEEDED',
    reconciling: service.reconciling ?? false,
    iam_bindings: Object.freeze(iamBindings),
  });
}

async function observeServices(session, fetchImplementation) {
  const url = new URL(
    `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services`,
  );
  url.searchParams.set('pageSize', '100');
  const response = await request(fetchImplementation, url, session.accessToken, {
    description: 'Cloud Run service inventory',
  });
  const value = parseJson(response.bytes, 'Cloud Run service inventory');
  if (!plainObject(value) || !Array.isArray(value.services)
    || (value.nextPageToken !== undefined && value.nextPageToken !== '')) {
    reject('Cloud Run service inventory is malformed or incomplete');
  }
  const names = value.services.map(({ name }) => serviceName(name));
  if (new Set(names).size !== names.length) reject('Cloud Run service inventory contains duplicates');
  return Object.freeze({ value, names: Object.freeze([...names].sort()) });
}

async function observeServicePolicy(session, service, fetchImplementation) {
  const url = new URL(`https://run.googleapis.com/v2/${service.name}:getIamPolicy`);
  const response = await request(fetchImplementation, url, session.accessToken, {
    description: `${serviceName(service.name)} IAM policy inventory`,
  });
  return parseJson(response.bytes, `${serviceName(service.name)} IAM policy inventory`);
}

async function observeServiceAccount(session, fetchImplementation) {
  const profile = validateRelayServicesProfile();
  const email = profile.runtime_identity.email;
  const url = new URL(
    `https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts/${encodeURIComponent(email)}`,
  );
  const response = await request(fetchImplementation, url, session.accessToken, {
    description: 'Relay service-account inventory',
    allowedStatuses: [200, 404],
  });
  if (response.status === 404) {
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-service-account-observation/1',
      email,
      state: 'absent',
    });
  }
  const account = parseJson(response.bytes, 'Relay service-account inventory');
  if (!plainObject(account) || account.email !== email
    || account.name !== `projects/${PROJECT_ID}/serviceAccounts/${email}`) {
    reject('Relay service-account inventory is foreign or malformed');
  }
  const keysUrl = new URL(`${url.toString()}/keys`);
  keysUrl.searchParams.append('keyTypes', 'USER_MANAGED');
  const keysResponse = await request(fetchImplementation, keysUrl, session.accessToken, {
    description: 'Relay user-managed key inventory',
  });
  const keys = parseJson(keysResponse.bytes, 'Relay user-managed key inventory');
  if (!plainObject(keys) || (keys.keys !== undefined && !Array.isArray(keys.keys))) {
    reject('Relay user-managed key inventory is malformed');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email,
    name: account.name,
    state: account.disabled === true ? 'disabled' : 'active',
    user_managed_keys: (keys.keys ?? []).length,
  });
}

async function observeRelayProjectRoles(session, fetchImplementation) {
  const profile = validateRelayServicesProfile();
  const response = await request(
    fetchImplementation,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`,
    session.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      contentType: true,
      description: 'Relay project IAM inventory',
    },
  );
  const policy = parseJson(response.bytes, 'Relay project IAM inventory');
  const member = `serviceAccount:${profile.runtime_identity.email}`;
  const roles = normalizeBindings(policy, 'Project')
    .filter((binding) => binding.members.includes(member))
    .map(({ role }) => role)
    .sort();
  return Object.freeze(roles);
}

function storageMetadataUrl(object, alt, generation) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(object)}`,
  );
  if (generation !== undefined) url.searchParams.set('generation', generation);
  if (alt !== undefined) url.searchParams.set('alt', alt);
  else url.searchParams.set('fields', 'bucket,name,generation,size');
  return url;
}

function stateResourceAddresses(state) {
  if (!Array.isArray(state.resources)) reject('Terraform state resources are malformed');
  const addresses = [];
  for (const resource of state.resources) {
    if (!plainObject(resource) || !['data', 'managed'].includes(resource.mode)
      || typeof resource.type !== 'string' || typeof resource.name !== 'string'
      || !Array.isArray(resource.instances)) {
      reject('Terraform state contains a malformed resource');
    }
    for (const instance of resource.instances) {
      if (!plainObject(instance)) reject('Terraform state contains a malformed instance');
      const prefix = resource.mode === 'data' ? 'data.' : '';
      const suffix = typeof instance.index_key === 'string'
        ? `[${JSON.stringify(instance.index_key)}]`
        : Number.isSafeInteger(instance.index_key) ? `[${instance.index_key}]` : '';
      addresses.push(`${prefix}${resource.type}.${resource.name}${suffix}`);
    }
  }
  return addresses.sort();
}

async function observeTerraformState(session, fetchImplementation) {
  const metadataResponse = await request(
    fetchImplementation,
    storageMetadataUrl(STATE_OBJECT),
    session.accessToken,
    {
      description: 'Relay Terraform state metadata inventory',
      allowedStatuses: [200, 404],
      maximumBytes: 64 * 1024,
    },
  );
  if (metadataResponse.status === 404) {
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-services-state-observation/1',
      bucket: STATE_BUCKET,
      object: STATE_OBJECT,
      state: 'absent',
    });
  }
  const metadata = parseJson(metadataResponse.bytes, 'Relay Terraform state metadata inventory');
  if (!plainObject(metadata) || metadata.bucket !== STATE_BUCKET || metadata.name !== STATE_OBJECT
    || !/^[1-9][0-9]*$/u.test(metadata.generation ?? '')
    || !/^[1-9][0-9]*$/u.test(metadata.size ?? '')) {
    reject('Relay Terraform state metadata is malformed');
  }
  const mediaResponse = await request(
    fetchImplementation,
    storageMetadataUrl(STATE_OBJECT, 'media', metadata.generation),
    session.accessToken,
    {
      description: 'Relay Terraform state content inventory',
      maximumBytes: MAXIMUM_JSON_BYTES,
    },
  );
  if (mediaResponse.bytes.byteLength !== Number(metadata.size)) {
    reject('Relay Terraform state metadata and content sizes differ');
  }
  const state = parseJson(mediaResponse.bytes, 'Relay Terraform state content inventory');
  if (!plainObject(state) || state.version !== 4 || state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(state.serial) || state.serial < 1
    || typeof state.lineage !== 'string' || state.lineage.length < 16
    || !plainObject(state.outputs)) {
    reject('Relay Terraform state content is malformed');
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-state-observation/1',
    bucket: STATE_BUCKET,
    object: STATE_OBJECT,
    state: 'present',
    generation: metadata.generation,
    size_bytes: mediaResponse.bytes.byteLength,
    sha256: sha256(mediaResponse.bytes),
    terraform_version: state.terraform_version,
    serial: state.serial,
    lineage_sha256: createHash('sha256').update(state.lineage).digest('hex'),
    resource_addresses: Object.freeze(stateResourceAddresses(state)),
    output_names: Object.freeze(Object.keys(state.outputs).sort()),
  });
}

async function observeClaimMetadata(session, fetchImplementation, object, description) {
  const response = await request(
    fetchImplementation,
    storageMetadataUrl(object),
    session.accessToken,
    {
      description: `${description} metadata inventory`,
      allowedStatuses: [200, 404],
      maximumBytes: 64 * 1024,
    },
  );
  if (response.status === 404) {
    return Object.freeze({
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: STATE_BUCKET,
      object,
      state: 'absent',
    });
  }
  const metadata = parseJson(response.bytes, `${description} metadata inventory`);
  if (!plainObject(metadata) || metadata.bucket !== STATE_BUCKET
    || metadata.name !== object
    || !/^[1-9][0-9]*$/u.test(metadata.generation ?? '')
    || !/^[1-9][0-9]*$/u.test(metadata.size ?? '')) {
    reject(`${description} metadata is malformed`);
  }
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object,
    state: 'present',
    generation: metadata.generation,
    size_bytes: Number(metadata.size),
  });
}

export async function observeRelayServicesInventory(
  session,
  fetchImplementation = globalThis.fetch,
) {
  const operator = validateSession(session);
  const transport = validateFetch(fetchImplementation);
  const profile = validateRelayServicesProfile();
  const [services, serviceAccount, projectRoles, terraformState, bootstrapClaim, recoveryClaim] =
    await Promise.all([
      observeServices(operator, transport),
      observeServiceAccount(operator, transport),
      observeRelayProjectRoles(operator, transport),
      observeTerraformState(operator, transport),
      observeClaimMetadata(operator, transport, BOOTSTRAP_CLAIM_OBJECT, 'Relay bootstrap claim'),
      observeClaimMetadata(operator, transport, RECOVERY_CLAIM_OBJECT, 'Relay recovery claim'),
    ]);
  const relayServiceValues = services.value.services
    .filter(({ name }) => profile.services.some((candidate) => candidate.name === serviceName(name)));
  const policies = await Promise.all(
    relayServiceValues.map((service) => observeServicePolicy(operator, service, transport)),
  );
  const relays = relayServiceValues.map((service, index) =>
    normalizeRelayService(service, policies[index], profile))
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    schema: 'miakapp.staging-browser-relay-services-inventory/2',
    project_id: PROJECT_ID,
    region: REGION,
    cloud_run_services: services.names,
    relays: Object.freeze(relays),
    relay_service_account: serviceAccount,
    relay_project_roles: projectRoles,
    terraform_state: terraformState,
    bootstrap_claim: bootstrapClaim,
    recovery_claim: recoveryClaim,
  });
}

export function validateRelayServicesBootstrapBaseline(value) {
  const profile = validateRelayServicesV3Profile();
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-browser-relay-services-inventory/1'
    || value.project_id !== PROJECT_ID
    || value.region !== REGION) {
    reject('Relay-services bootstrap baseline is malformed');
  }
  exact(value.cloud_run_services, ['control-plane'], 'Baseline Cloud Run services');
  exact(value.relays, [], 'Baseline relay services');
  exact(value.relay_service_account, {
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email: profile.runtime_identity.email,
    state: 'absent',
  }, 'Baseline relay service account');
  exact(value.relay_project_roles, [], 'Baseline relay project roles');
  exact(value.terraform_state, {
    schema: 'miakapp.staging-browser-relay-services-state-observation/1',
    bucket: STATE_BUCKET,
    object: STATE_OBJECT,
    state: 'present',
    generation: profile.operation.initial_state_generation,
    size_bytes: profile.operation.initial_state_size_bytes,
    sha256: profile.operation.initial_state_sha256,
    terraform_version: TERRAFORM_VERSION,
    serial: profile.operation.initial_state_serial,
    lineage_sha256: profile.operation.initial_state_lineage_sha256,
    resource_addresses: [],
    output_names: [],
  }, 'Baseline relay Terraform state');
  exact(value.operation_claim, {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: BOOTSTRAP_CLAIM_OBJECT,
    state: 'absent',
  }, 'Baseline relay bootstrap claim');
  return Object.freeze(value);
}

function expectedEnvironment(profile, service, relayAudience = service.bootstrap_audience) {
  return {
    MIAKAPP_ALLOWED_ORIGINS: profile.application.allowed_origin,
    MIAKAPP_CONNECTION_ATTEMPTS_PER_MINUTE:
      String(profile.admission.connection_attempts_per_minute_per_immediate_peer),
    MIAKAPP_CONTROL_PLANE_ISSUER: profile.control_plane.issuer,
    MIAKAPP_CONTROL_PLANE_JWKS_URL: profile.control_plane.jwks_url,
    MIAKAPP_DECLARATION_TIMEOUT: profile.relay_runtime.declaration_timeout,
    MIAKAPP_DISCONNECT_GRACE: profile.relay_runtime.disconnect_grace,
    MIAKAPP_HANDSHAKE_TIMEOUT: profile.relay_runtime.handshake_timeout,
    MIAKAPP_LISTEN_ADDRESS: `:${profile.cloud_run.port}`,
    MIAKAPP_MAX_AGGREGATE_QUEUED_BYTES:
      String(profile.admission.maximum_aggregate_queued_bytes),
    MIAKAPP_MAX_CONNECTIONS: String(profile.admission.maximum_connections),
    MIAKAPP_MAX_CONNECTIONS_PER_IP:
      String(profile.admission.maximum_connections_per_immediate_peer),
    MIAKAPP_MAX_HOMES: String(profile.admission.maximum_homes),
    MIAKAPP_MAX_QUEUED_BYTES:
      String(profile.admission.maximum_queued_bytes_per_connection),
    MIAKAPP_MAX_TRACKED_IPS:
      String(profile.admission.maximum_tracked_immediate_peers),
    MIAKAPP_PING_INTERVAL: profile.relay_runtime.ping_interval,
    MIAKAPP_PONG_TIMEOUT: profile.relay_runtime.pong_timeout,
    MIAKAPP_RELAY_AUDIENCE: relayAudience,
    MIAKAPP_SHUTDOWN_TIMEOUT: profile.relay_runtime.shutdown_timeout,
    MIAKAPP_WRITE_TIMEOUT: profile.relay_runtime.write_timeout,
  };
}

function validateDeployedRelay(
  relay,
  service,
  profile,
  relayAudience = service.bootstrap_audience,
) {
  if (!plainObject(relay)
    || relay.id !== service.id
    || relay.name !== service.name
    || relay.resource_name
      !== `projects/${PROJECT_ID}/locations/${REGION}/services/${service.name}`
    || typeof relay.uri !== 'string'
    || !new RegExp(service.audience_pattern.replace('^wss:', '^https:').replace('/ws$', '$'), 'u')
      .test(relay.uri)
    || !/^[1-9][0-9]*$/u.test(relay.generation)
    || relay.ingress !== profile.cloud_run.ingress
    || relay.service_account !== profile.runtime_identity.email
    || relay.execution_environment !== profile.cloud_run.execution_environment
    || relay.minimum_instances !== profile.cloud_run.minimum_instances
    || relay.maximum_instances !== profile.cloud_run.maximum_instances
    || relay.concurrency !== profile.cloud_run.concurrency
    || relay.timeout !== `${profile.cloud_run.request_timeout_seconds}s`
    || relay.session_affinity !== profile.cloud_run.session_affinity
    || relay.container?.name !== 'relay'
    || relay.container?.image !== profile.image.digest_reference
    || relay.container?.cpu !== profile.cloud_run.cpu
    || relay.container?.memory !== profile.cloud_run.memory
    || relay.container?.cpu_idle !== profile.cloud_run.cpu_idle
    || relay.container?.startup_cpu_boost !== profile.cloud_run.startup_cpu_boost
    || !isDeepStrictEqual(
      relay.container?.environment,
      expectedEnvironment(profile, service, relayAudience),
    )
    || !isDeepStrictEqual(relay.container?.ports, [{ name: 'http1', container_port: 3000 }])
    || !isDeepStrictEqual(relay.container?.startup_probe, {
      path: '/ping',
      port: 3000,
      initial_delay_seconds: 0,
      timeout_seconds: 2,
      period_seconds: 2,
      failure_threshold: 10,
    })
    || !isDeepStrictEqual(relay.traffic, [{
      type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
      percent: 100,
    }])
    || relay.ready !== true
    || relay.reconciling !== false
    || !isDeepStrictEqual(relay.iam_bindings, [])) {
    reject(`${service.id} does not match the reviewed private bootstrap service`);
  }
  const expectedLabels = {
    component: 'browser-relay',
    environment: 'staging',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    relay: service.id,
  };
  for (const [name, expected] of Object.entries(expectedLabels)) {
    if (relay.labels[name] !== expected) reject(`${service.id} labels have drifted`);
  }
  for (const binding of relay.iam_bindings) {
    if (binding.members.includes('allUsers') || binding.members.includes('allAuthenticatedUsers')) {
      reject(`${service.id} exposes a public invoker`);
    }
  }
}

export function validateRelayServicesPrivateBootstrapInventory(value, claimReceipt) {
  const profile = validateRelayServicesV3Profile();
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-browser-relay-services-inventory/1'
    || value.project_id !== PROJECT_ID
    || value.region !== REGION
    || !plainObject(claimReceipt)
    || !/^[1-9][0-9]*$/u.test(claimReceipt.generation ?? '')) {
    reject('Private relay bootstrap inventory is malformed');
  }
  exact(
    value.cloud_run_services,
    ['control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b'],
    'Private bootstrap Cloud Run services',
  );
  if (!Array.isArray(value.relays) || value.relays.length !== 2) {
    reject('Private bootstrap must contain exactly two relay services');
  }
  for (const service of profile.services) {
    validateDeployedRelay(
      value.relays.find((relay) => relay.id === service.id),
      service,
      profile,
    );
  }
  exact(value.relay_service_account, {
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email: profile.runtime_identity.email,
    name: `projects/${PROJECT_ID}/serviceAccounts/${profile.runtime_identity.email}`,
    state: 'active',
    user_managed_keys: 0,
  }, 'Private bootstrap relay service account');
  exact(value.relay_project_roles, [], 'Private bootstrap relay project roles');
  if (!plainObject(value.terraform_state)
    || value.terraform_state.schema
      !== 'miakapp.staging-browser-relay-services-state-observation/1'
    || value.terraform_state.bucket !== STATE_BUCKET
    || value.terraform_state.object !== STATE_OBJECT
    || value.terraform_state.state !== 'present'
    || !/^[1-9][0-9]*$/u.test(value.terraform_state.generation ?? '')
    || value.terraform_state.generation === profile.operation.initial_state_generation
    || value.terraform_state.terraform_version !== TERRAFORM_VERSION
    || value.terraform_state.serial <= profile.operation.initial_state_serial
    || value.terraform_state.lineage_sha256 !== profile.operation.initial_state_lineage_sha256) {
    reject('Private bootstrap Terraform state did not advance from the reviewed lineage');
  }
  exact(value.terraform_state.resource_addresses, [
    'data.terraform_remote_state.workload[0]',
    'google_cloud_run_v2_service.relay["relay-a"]',
    'google_cloud_run_v2_service.relay["relay-b"]',
    'google_service_account.relay["runtime"]',
    'terraform_data.deployment_guard["active"]',
  ], 'Private bootstrap Terraform state resources');
  exact(
    value.terraform_state.output_names,
    ['staging_browser_relays'],
    'Private bootstrap Terraform state outputs',
  );
  exact(value.operation_claim, {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: BOOTSTRAP_CLAIM_OBJECT,
    state: 'present',
    generation: claimReceipt.generation,
    size_bytes: claimReceipt.size_bytes,
  }, 'Private bootstrap operation claim');
  return Object.freeze(value);
}

function validateRecoveryInventoryEnvelope(value, description) {
  if (!plainObject(value)
    || value.schema !== 'miakapp.staging-browser-relay-services-inventory/2'
    || value.project_id !== PROJECT_ID || value.region !== REGION) {
    reject(`${description} is malformed`);
  }
  exact(Object.keys(value).sort(), [
    'bootstrap_claim', 'cloud_run_services', 'project_id', 'recovery_claim',
    'region', 'relay_project_roles', 'relay_service_account', 'relays', 'schema',
    'terraform_state',
  ], `${description} fields`);
  return value;
}

function expectedBootstrapClaim(profile) {
  return {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: profile.operation.original_claim_object,
    state: 'present',
    generation: profile.operation.original_claim_generation,
    size_bytes: profile.operation.original_claim_size_bytes,
  };
}

function recoveryClaimAbsence() {
  return {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: RECOVERY_CLAIM_OBJECT,
    state: 'absent',
  };
}

export function validateRelayServicesRecoveryBaseline(value) {
  const profile = validateRelayServicesV4Profile();
  validateRecoveryInventoryEnvelope(value, 'Relay-services recovery baseline');
  exact(value.cloud_run_services, ['control-plane'], 'Recovery baseline Cloud Run services');
  exact(value.relays, [], 'Recovery baseline relay services');
  exact(value.relay_service_account, {
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email: profile.runtime_identity.email,
    name: `projects/${PROJECT_ID}/serviceAccounts/${profile.runtime_identity.email}`,
    state: 'active',
    user_managed_keys: 0,
  }, 'Recovery baseline relay service account');
  exact(value.relay_project_roles, [], 'Recovery baseline relay project roles');
  exact(value.terraform_state, {
    schema: 'miakapp.staging-browser-relay-services-state-observation/1',
    bucket: STATE_BUCKET,
    object: STATE_OBJECT,
    state: 'present',
    generation: profile.operation.initial_state_generation,
    size_bytes: profile.operation.initial_state_size_bytes,
    sha256: profile.operation.initial_state_sha256,
    terraform_version: TERRAFORM_VERSION,
    serial: profile.operation.initial_state_serial,
    lineage_sha256: profile.operation.initial_state_lineage_sha256,
    resource_addresses: [
      'data.terraform_remote_state.workload[0]',
      'google_service_account.relay["runtime"]',
      'terraform_data.deployment_guard["active"]',
    ],
    output_names: [],
  }, 'Recovery baseline relay Terraform state');
  exact(value.bootstrap_claim, expectedBootstrapClaim(profile), 'Recovery baseline bootstrap claim');
  exact(value.recovery_claim, recoveryClaimAbsence(), 'Recovery claim absence');
  return Object.freeze(value);
}

export function validateRelayServicesRecoveredInventory(value, recoveryClaimReceipt) {
  const profile = validateRelayServicesV4Profile();
  validateRecoveryInventoryEnvelope(value, 'Recovered private relay inventory');
  if (!plainObject(recoveryClaimReceipt)
    || !/^[1-9][0-9]*$/u.test(recoveryClaimReceipt.generation ?? '')
    || !Number.isSafeInteger(recoveryClaimReceipt.size_bytes)
    || recoveryClaimReceipt.size_bytes < 1) {
    reject('Recovery claim receipt is malformed');
  }
  exact(value.cloud_run_services, [
    'control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b',
  ], 'Recovered private Cloud Run services');
  if (!Array.isArray(value.relays) || value.relays.length !== 2) {
    reject('Recovered private inventory must contain exactly two relay services');
  }
  for (const service of profile.services) {
    validateDeployedRelay(
      value.relays.find((relay) => relay.id === service.id),
      service,
      profile,
    );
  }
  exact(value.relay_service_account, {
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email: profile.runtime_identity.email,
    name: `projects/${PROJECT_ID}/serviceAccounts/${profile.runtime_identity.email}`,
    state: 'active',
    user_managed_keys: 0,
  }, 'Recovered relay service account');
  exact(value.relay_project_roles, [], 'Recovered relay project roles');
  if (!plainObject(value.terraform_state)
    || value.terraform_state.schema
      !== 'miakapp.staging-browser-relay-services-state-observation/1'
    || value.terraform_state.bucket !== STATE_BUCKET
    || value.terraform_state.object !== STATE_OBJECT
    || value.terraform_state.state !== 'present'
    || !/^[1-9][0-9]*$/u.test(value.terraform_state.generation ?? '')
    || value.terraform_state.generation === profile.operation.initial_state_generation
    || !Number.isSafeInteger(value.terraform_state.size_bytes)
    || value.terraform_state.size_bytes < 1
    || !/^[0-9a-f]{64}$/u.test(value.terraform_state.sha256 ?? '')
    || value.terraform_state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(value.terraform_state.serial)
    || value.terraform_state.serial <= profile.operation.initial_state_serial
    || value.terraform_state.lineage_sha256 !== profile.operation.initial_state_lineage_sha256) {
    reject('Recovered relay Terraform state did not advance from the reviewed partial state');
  }
  exact(value.terraform_state.resource_addresses, [
    'data.terraform_remote_state.workload[0]',
    'google_cloud_run_v2_service.relay["relay-a"]',
    'google_cloud_run_v2_service.relay["relay-b"]',
    'google_service_account.relay["runtime"]',
    'terraform_data.deployment_guard["active"]',
  ], 'Recovered relay Terraform state resources');
  exact(value.terraform_state.output_names, ['staging_browser_relays'], 'Recovered relay outputs');
  exact(value.bootstrap_claim, expectedBootstrapClaim(profile), 'Recovered bootstrap claim');
  exact(value.recovery_claim, {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: RECOVERY_CLAIM_OBJECT,
    state: 'present',
    generation: recoveryClaimReceipt.generation,
    size_bytes: recoveryClaimReceipt.size_bytes,
  }, 'Recovered operation claim');
  return Object.freeze(value);
}

export function relayServicesInventorySha256(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function privateReadyClaimAbsence() {
  return {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: PRIVATE_READY_CLAIM_OBJECT,
    state: 'absent',
  };
}

function expectedRecoveryClaim(profile) {
  return {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: STATE_BUCKET,
    object: profile.operation.memory_recovery_claim_object,
    state: 'present',
    generation: profile.operation.memory_recovery_claim_generation,
    size_bytes: profile.operation.memory_recovery_claim_size_bytes,
  };
}

function validateCurrentPrivateRelayEnvelope(
  inventory,
  description,
  profile = validateRelayServicesProfile(),
) {
  validateRecoveryInventoryEnvelope(inventory, description);
  exact(inventory.cloud_run_services, [
    'control-plane', 'miakapp-staging-relay-a', 'miakapp-staging-relay-b',
  ], `${description} Cloud Run services`);
  if (!Array.isArray(inventory.relays) || inventory.relays.length !== 2) {
    reject(`${description} must contain exactly two relay services`);
  }
  exact(inventory.relay_service_account, {
    schema: 'miakapp.staging-browser-relay-service-account-observation/1',
    email: profile.runtime_identity.email,
    name: `projects/${PROJECT_ID}/serviceAccounts/${profile.runtime_identity.email}`,
    state: 'active',
    user_managed_keys: 0,
  }, `${description} service account`);
  exact(inventory.relay_project_roles, [], `${description} project roles`);
  exact(inventory.bootstrap_claim, expectedBootstrapClaim(profile), `${description} bootstrap claim`);
  exact(inventory.recovery_claim, expectedRecoveryClaim(profile), `${description} recovery claim`);
  return profile;
}

export function validateRelayServicesPrivateReadyBaseline(value) {
  if (!plainObject(value) || value.schema
      !== 'miakapp.staging-browser-relay-services-private-ready-baseline/1'
    || !plainObject(value.inventory) || !plainObject(value.private_ready_claim)
    || !isDeepStrictEqual(Object.keys(value).sort(), [
      'inventory', 'private_ready_claim', 'schema',
    ])) {
    reject('Relay-services private-ready baseline is malformed');
  }
  const profile = validateCurrentPrivateRelayEnvelope(
    value.inventory,
    'Relay-services private-ready baseline',
    validateRelayServicesV5Profile(),
  );
  for (const service of profile.services) {
    const relay = value.inventory.relays.find((candidate) => candidate.id === service.id);
    validateDeployedRelay(relay, service, profile, service.bootstrap_audience);
    if (relay.uri !== service.assigned_uri || relay.generation !== '1') {
      reject(`${service.id} assigned URI or generation has drifted before private-ready`);
    }
  }
  exact(value.inventory.terraform_state, {
    schema: 'miakapp.staging-browser-relay-services-state-observation/1',
    bucket: STATE_BUCKET,
    object: STATE_OBJECT,
    state: 'present',
    generation: profile.operation.initial_state_generation,
    size_bytes: profile.operation.initial_state_size_bytes,
    sha256: profile.operation.initial_state_sha256,
    terraform_version: TERRAFORM_VERSION,
    serial: profile.operation.initial_state_serial,
    lineage_sha256: profile.operation.initial_state_lineage_sha256,
    resource_addresses: [
      'data.terraform_remote_state.workload[0]',
      'google_cloud_run_v2_service.relay["relay-a"]',
      'google_cloud_run_v2_service.relay["relay-b"]',
      'google_service_account.relay["runtime"]',
      'terraform_data.deployment_guard["active"]',
    ],
    output_names: ['staging_browser_relays'],
  }, 'Relay-services private-ready baseline Terraform state');
  exact(value.private_ready_claim, privateReadyClaimAbsence(), 'Private-ready claim absence');
  return Object.freeze(value);
}

export function validateRelayServicesPrivateReadyInventory(inventory, claimReceipt) {
  const profile = validateCurrentPrivateRelayEnvelope(
    inventory,
    'Relay-services private-ready inventory',
    validateRelayServicesV5Profile(),
  );
  if (!plainObject(claimReceipt)
    || !/^[1-9][0-9]*$/u.test(claimReceipt.generation ?? '')
    || !Number.isSafeInteger(claimReceipt.size_bytes) || claimReceipt.size_bytes < 1) {
    reject('Private-ready claim receipt is malformed');
  }
  for (const service of profile.services) {
    const relay = inventory.relays.find((candidate) => candidate.id === service.id);
    validateDeployedRelay(relay, service, profile, service.ready_audience);
    if (relay.uri !== service.assigned_uri
      || !/^[1-9][0-9]*$/u.test(relay.generation)
      || Number(relay.generation) <= 1) {
      reject(`${service.id} did not advance to its assigned private-ready audience`);
    }
  }
  const state = inventory.terraform_state;
  if (!plainObject(state)
    || state.schema !== 'miakapp.staging-browser-relay-services-state-observation/1'
    || state.bucket !== STATE_BUCKET || state.object !== STATE_OBJECT
    || state.state !== 'present' || !/^[1-9][0-9]*$/u.test(state.generation ?? '')
    || state.generation === profile.operation.initial_state_generation
    || !Number.isSafeInteger(state.size_bytes) || state.size_bytes < 1
    || !/^[0-9a-f]{64}$/u.test(state.sha256 ?? '')
    || state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(state.serial) || state.serial <= profile.operation.initial_state_serial
    || state.lineage_sha256 !== profile.operation.initial_state_lineage_sha256) {
    reject('Private-ready Terraform state did not advance from the reviewed recovery state');
  }
  exact(state.resource_addresses, [
    'data.terraform_remote_state.workload[0]',
    'google_cloud_run_v2_service.relay["relay-a"]',
    'google_cloud_run_v2_service.relay["relay-b"]',
    'google_service_account.relay["runtime"]',
    'terraform_data.deployment_guard["active"]',
  ], 'Private-ready Terraform state resources');
  exact(state.output_names, ['staging_browser_relays'], 'Private-ready Terraform outputs');
  return Object.freeze(inventory);
}
