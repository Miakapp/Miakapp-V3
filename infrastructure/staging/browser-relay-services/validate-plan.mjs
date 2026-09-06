import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  REGION,
  RELAY_SERVICES_PROFILE_SHA256,
  TERRAFORM_VERSION,
  bootstrapRelayVariables,
  validateRelayServicesProfile,
} from './contract.mjs';

const GOOGLE_PROVIDER = 'registry.terraform.io/hashicorp/google';
const TERRAFORM_PROVIDER = 'terraform.io/builtin/terraform';
const MAXIMUM_PLAN_BYTES = 32 * 1024 * 1024;
const CONFIGURATION_RESOURCES = Object.freeze({
  'data.terraform_remote_state.workload': ['data', 'terraform_remote_state', 'terraform'],
  'google_cloud_run_v2_service.relay': ['managed', 'google_cloud_run_v2_service', 'google'],
  'google_cloud_run_v2_service_iam_member.public': [
    'managed',
    'google_cloud_run_v2_service_iam_member',
    'google',
  ],
  'google_service_account.relay': ['managed', 'google_service_account', 'google'],
  'terraform_data.deployment_guard': ['managed', 'terraform_data', 'terraform'],
});
const PLANNED_RESOURCES = Object.freeze({
  'google_cloud_run_v2_service.relay["relay-a"]': 'google_cloud_run_v2_service',
  'google_cloud_run_v2_service.relay["relay-b"]': 'google_cloud_run_v2_service',
  'google_service_account.relay["runtime"]': 'google_service_account',
  'terraform_data.deployment_guard["active"]': 'terraform_data',
});
const EXPECTED_CHECKS = Object.freeze({
  'google_cloud_run_v2_service.relay': Object.freeze({
    status: 'unknown',
    instances: Object.freeze({
      'google_cloud_run_v2_service.relay["relay-a"]': 'unknown',
      'google_cloud_run_v2_service.relay["relay-b"]': 'unknown',
    }),
  }),
  'terraform_data.deployment_guard': Object.freeze({
    status: 'pass',
    instances: Object.freeze({ 'terraform_data.deployment_guard["active"]': 'pass' }),
  }),
  'var.deployment_phase': Object.freeze({
    status: 'pass',
    instances: Object.freeze({ 'var.deployment_phase': 'pass' }),
  }),
  'var.relay_audiences': Object.freeze({
    status: 'pass',
    instances: Object.freeze({ 'var.relay_audiences': 'pass' }),
  }),
});

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, description) {
  if (!isDeepStrictEqual(value, expected)) reject(`${description} does not match the reviewed value`);
}

function rejectForbiddenValues(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenValues(entry, [...path, index]));
    return;
  }
  if (plainObject(value)) {
    for (const [name, entry] of Object.entries(value)) {
      rejectForbiddenValues(entry, [...path, name]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  const field = String(path.at(-1) ?? '');
  const parent = String(path.at(-2) ?? '');
  const reviewedProductLabel = value === 'miakapp-v4' && field === 'product'
    && ['labels', 'effective_labels', 'terraform_labels'].includes(parent);
  if (value === 'allUsers' || value === 'allAuthenticatedUsers'
    || value === 'miakapp-3' || value.includes('projects/miakapp-3/')
    || value.includes('@miakapp-3.') || value.startsWith('miakapp-3.')
    || value === 'miakapp-v4' && !reviewedProductLabel
    || value.includes('projects/miakapp-v4/') || value.includes('@miakapp-v4.')
    || value.startsWith('miakapp-v4.')) {
    reject('Terraform relay-services plan contains a forbidden public principal or project');
  }
}

function validateConfiguration(plan) {
  const configuration = plan.configuration;
  if (!plainObject(configuration) || !plainObject(configuration.root_module)
    || configuration.root_module.module_calls !== undefined
    || !Array.isArray(configuration.root_module.resources)) {
    reject('Terraform relay-services configuration must be one flat root module');
  }
  const seen = new Set();
  for (const resource of configuration.root_module.resources) {
    if (!plainObject(resource) || typeof resource.address !== 'string'
      || seen.has(resource.address) || CONFIGURATION_RESOURCES[resource.address] === undefined) {
      reject('Terraform relay-services configuration contains an unreviewed resource');
    }
    seen.add(resource.address);
    const [mode, type, provider] = CONFIGURATION_RESOURCES[resource.address];
    exact(resource.mode, mode, `${resource.address}.mode`);
    exact(resource.type, type, `${resource.address}.type`);
    exact(resource.provider_config_key, provider, `${resource.address}.provider`);
  }
  exact([...seen].sort(), Object.keys(CONFIGURATION_RESOURCES).sort(), 'Terraform configuration resources');

  const providers = configuration.provider_config;
  if (!plainObject(providers)) reject('Terraform provider configuration is missing');
  exact(Object.keys(providers).sort(), ['google', 'terraform'], 'Terraform providers');
  exact(providers.google?.full_name, GOOGLE_PROVIDER, 'Google provider');
  exact(providers.google?.version_constraint, '8.1.0', 'Google provider version');
  exact(providers.terraform?.full_name, TERRAFORM_PROVIDER, 'Terraform built-in provider');
}

function expectedEnvironment(profile, service) {
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
    MIAKAPP_RELAY_AUDIENCE: service.bootstrap_audience,
    MIAKAPP_SHUTDOWN_TIMEOUT: profile.relay_runtime.shutdown_timeout,
    MIAKAPP_WRITE_TIMEOUT: profile.relay_runtime.write_timeout,
  };
}

function normalizeEnvironment(entries, address) {
  if (!Array.isArray(entries)) reject(`${address} environment is missing`);
  const result = {};
  for (const entry of entries) {
    if (!plainObject(entry) || typeof entry.name !== 'string'
      || typeof entry.value !== 'string' || !isDeepStrictEqual(entry.value_source, [])
      || Object.hasOwn(result, entry.name)) {
      reject(`${address} environment contains an unreviewed entry`);
    }
    result[entry.name] = entry.value;
  }
  return result;
}

function validateRelay(change, service, profile) {
  const address = `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`;
  const after = change.change.after;
  if (!plainObject(after) || !Array.isArray(after.template) || after.template.length !== 1
    || !Array.isArray(after.template[0].containers)
    || after.template[0].containers.length !== 1) {
    reject(`${address} planned service is malformed`);
  }
  const template = after.template[0];
  const container = template.containers[0];
  const labels = {
    component: 'browser-relay',
    environment: 'staging',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    relay: service.id,
  };
  exact(after.project, PROJECT_ID, `${address}.project`);
  exact(after.location, REGION, `${address}.location`);
  exact(after.name, service.name, `${address}.name`);
  exact(after.ingress, profile.cloud_run.ingress, `${address}.ingress`);
  exact(after.labels, labels, `${address}.labels`);
  exact(after.deletion_protection, false, `${address}.deletion_protection`);
  exact(after.default_uri_disabled, false, `${address}.default_uri_disabled`);
  exact(after.invoker_iam_disabled, false, `${address}.invoker_iam_disabled`);
  exact(after.iap_enabled, false, `${address}.iap_enabled`);
  exact(after.launch_stage, 'GA', `${address}.launch_stage`);
  exact(after.binary_authorization, [{
    breakglass_justification: null,
    policy: null,
    use_default: false,
  }], `${address}.binary_authorization`);
  exact(after.build_config, [], `${address}.build_config`);
  exact(after.custom_audiences, null, `${address}.custom_audiences`);
  exact(after.tags, null, `${address}.tags`);

  exact(template.execution_environment, profile.cloud_run.execution_environment, `${address}.execution_environment`);
  exact(template.service_account, profile.runtime_identity.email, `${address}.service_account`);
  exact(template.max_instance_request_concurrency, profile.cloud_run.concurrency, `${address}.concurrency`);
  exact(template.scaling, [{
    max_instance_count: profile.cloud_run.maximum_instances,
    min_instance_count: profile.cloud_run.minimum_instances,
  }], `${address}.scaling`);
  exact(template.timeout, `${profile.cloud_run.request_timeout_seconds}s`, `${address}.timeout`);
  exact(template.session_affinity, false, `${address}.session_affinity`);
  exact(template.volumes, [], `${address}.volumes`);
  exact(template.vpc_access, [], `${address}.vpc_access`);
  exact(template.encryption_key, null, `${address}.encryption_key`);

  exact(container.name, 'relay', `${address}.container.name`);
  exact(container.image, profile.image.digest_reference, `${address}.container.image`);
  exact(container.command, null, `${address}.container.command`);
  exact(container.args, null, `${address}.container.args`);
  exact(container.volume_mounts, [], `${address}.container.volume_mounts`);
  exact(container.ports, [{ container_port: profile.cloud_run.port, name: 'http1' }], `${address}.container.ports`);
  exact(container.resources, [{
    cpu_idle: true,
    limits: { cpu: profile.cloud_run.cpu, memory: profile.cloud_run.memory },
    startup_cpu_boost: false,
  }], `${address}.container.resources`);
  exact(container.startup_probe, [{
    failure_threshold: 10,
    grpc: [],
    http_get: [{ http_headers: [], path: '/ping', port: profile.cloud_run.port }],
    initial_delay_seconds: 0,
    period_seconds: 2,
    tcp_socket: [],
    timeout_seconds: 2,
  }], `${address}.container.startup_probe`);
  exact(container.liveness_probe, [], `${address}.container.liveness_probe`);
  exact(container.readiness_probe, [], `${address}.container.readiness_probe`);
  exact(normalizeEnvironment(container.env, address), expectedEnvironment(profile, service), `${address}.environment`);
  exact(after.traffic, [{
    percent: 100,
    revision: null,
    tag: null,
    type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
  }], `${address}.traffic`);
}

function validateServiceAccount(change, profile) {
  const address = 'google_service_account.relay["runtime"]';
  const after = change.change.after;
  if (!plainObject(after)) reject(`${address} planned value is missing`);
  exact(after.project, PROJECT_ID, `${address}.project`);
  exact(after.account_id, profile.runtime_identity.account_id, `${address}.account_id`);
  exact(after.email, profile.runtime_identity.email, `${address}.email`);
  exact(after.member, `serviceAccount:${profile.runtime_identity.email}`, `${address}.member`);
  exact(after.disabled, false, `${address}.disabled`);
  exact(after.deletion_policy, 'DELETE', `${address}.deletion_policy`);
  exact(after.create_ignore_already_exists, null, `${address}.create_ignore_already_exists`);
}

function validateGuard(change, profile) {
  const after = change.change.after;
  if (!plainObject(after)) reject('Terraform relay deployment guard is missing');
  exact(after.input, {
    deployment_phase: 'private_bootstrap',
    profile_sha256: RELAY_SERVICES_PROFILE_SHA256,
    relay_audiences: bootstrapRelayVariables(profile).relay_audiences,
    relay_image: profile.image.digest_reference,
    relay_source_commit: profile.pins.miakapp_server_commit,
  }, 'Terraform relay deployment guard');
  exact(after.triggers_replace, null, 'Terraform relay deployment guard replacement');
}

function validateResourceChanges(plan, profile) {
  if (!Array.isArray(plan.resource_changes)) reject('Terraform relay-services changes are missing');
  const byAddress = new Map();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string'
      || byAddress.has(change.address) || PLANNED_RESOURCES[change.address] === undefined) {
      reject('Terraform relay-services plan contains an unreviewed resource change');
    }
    byAddress.set(change.address, change);
    exact(change.mode, 'managed', `${change.address}.mode`);
    exact(change.type, PLANNED_RESOURCES[change.address], `${change.address}.type`);
    exact(change.provider_name,
      change.type === 'terraform_data' ? TERRAFORM_PROVIDER : GOOGLE_PROVIDER,
      `${change.address}.provider`);
    exact(change.change?.actions, ['create'], `${change.address}.actions`);
    exact(change.change?.before, null, `${change.address}.before`);
    if (change.change?.importing !== undefined) reject('Terraform relay-services plan contains an import');
  }
  exact([...byAddress.keys()].sort(), Object.keys(PLANNED_RESOURCES).sort(), 'Terraform changed resources');
  for (const service of profile.services) {
    validateRelay(byAddress.get(`google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`), service, profile);
  }
  validateServiceAccount(byAddress.get('google_service_account.relay["runtime"]'), profile);
  validateGuard(byAddress.get('terraform_data.deployment_guard["active"]'), profile);
}

function validatePlannedValues(plan) {
  const root = plan.planned_values?.root_module;
  if (!plainObject(root) || root.child_modules !== undefined || !Array.isArray(root.resources)) {
    reject('Terraform planned values must contain one flat reviewed root module');
  }
  const resources = Object.fromEntries(root.resources.map((resource) => [resource.address, resource]));
  if (Object.keys(resources).length !== root.resources.length) reject('Terraform planned values contain duplicates');
  exact(Object.keys(resources).sort(), Object.keys(PLANNED_RESOURCES).sort(), 'Terraform planned resources');
  for (const [address, type] of Object.entries(PLANNED_RESOURCES)) {
    exact(resources[address].mode, 'managed', `${address}.planned mode`);
    exact(resources[address].type, type, `${address}.planned type`);
  }
  exact(Object.keys(plan.planned_values.outputs ?? {}), ['staging_browser_relays'], 'Terraform planned outputs');
  exact(plan.planned_values.outputs.staging_browser_relays.sensitive, false, 'Terraform relay output sensitivity');
}

function validatePriorState(plan) {
  const root = plan.prior_state?.values?.root_module;
  if (!plainObject(root) || root.child_modules !== undefined || !Array.isArray(root.resources)
    || root.resources.length !== 1) {
    reject('Terraform prior state must contain only the reviewed workload observation');
  }
  const workload = root.resources[0];
  exact(workload.address, 'data.terraform_remote_state.workload[0]', 'Terraform prior workload address');
  exact(workload.mode, 'data', 'Terraform prior workload mode');
  exact(workload.type, 'terraform_remote_state', 'Terraform prior workload type');
  exact(workload.provider_name, TERRAFORM_PROVIDER, 'Terraform prior workload provider');
}

function validateChecks(plan) {
  if (!Array.isArray(plan.checks)) reject('Terraform relay-services checks are missing');
  const observed = {};
  for (const check of plan.checks) {
    const address = check.address?.to_display;
    if (typeof address !== 'string' || observed[address] !== undefined
      || EXPECTED_CHECKS[address] === undefined || !Array.isArray(check.instances)) {
      reject('Terraform relay-services plan contains an unreviewed check');
    }
    observed[address] = {
      status: check.status,
      instances: Object.fromEntries(check.instances.map((instance) => [
        instance.address?.to_display,
        instance.status,
      ])),
    };
  }
  exact(observed, EXPECTED_CHECKS, 'Terraform relay-services checks');
}

export function validateInitialRelayServicesPlan(plan) {
  const profile = validateRelayServicesProfile();
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true || plan.complete !== true || plan.errored !== false
    || plan.resource_drift !== undefined) {
    reject('Terraform relay-services plan format or version is invalid');
  }
  rejectForbiddenValues(plan.variables);
  rejectForbiddenValues(plan.resource_changes);
  rejectForbiddenValues(plan.planned_values);
  exact(plan.variables, Object.fromEntries(Object.entries(bootstrapRelayVariables(profile))
    .map(([name, value]) => [name, { value }])), 'Terraform relay-services variables');
  validateConfiguration(plan);
  validateResourceChanges(plan, profile);
  validatePlannedValues(plan);
  validatePriorState(plan);
  validateChecks(plan);
  return Object.freeze({
    create: 4,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    relay_services: 2,
    service_accounts: 1,
    public_iam_members: 0,
    live_requests: 0,
    resource_addresses: Object.freeze(Object.keys(PLANNED_RESOURCES).sort()),
  });
}

export function readAndValidateInitialRelayServicesPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform relay-services plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform relay-services plan JSON is invalid');
  }
  return validateInitialRelayServicesPlan(plan);
}
