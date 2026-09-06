import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  PROJECT_ID,
  REGION,
  RELAY_SERVICES_V5_PROFILE_SHA256,
  RELAY_SERVICES_V3_PROFILE_SHA256,
  RELAY_SERVICES_V4_PROFILE_SHA256,
  TERRAFORM_VERSION,
  bootstrapRelayVariables,
  privateReadyRelayVariables,
  validateRelayServicesV5Profile,
  validateRelayServicesV3Profile,
  validateRelayServicesV4Profile,
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

function guardInput(profile, profileSha256) {
  return {
    deployment_phase: 'private_bootstrap',
    profile_sha256: profileSha256,
    relay_audiences: bootstrapRelayVariables(profile).relay_audiences,
    relay_image: profile.image.digest_reference,
    relay_source_commit: profile.pins.miakapp_server_commit,
  };
}

function validateGuard(change, profile, profileSha256) {
  const after = change.change.after;
  if (!plainObject(after)) reject('Terraform relay deployment guard is missing');
  exact(after.input, guardInput(profile, profileSha256), 'Terraform relay deployment guard');
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
  validateGuard(
    byAddress.get('terraform_data.deployment_guard["active"]'),
    profile,
    RELAY_SERVICES_V3_PROFILE_SHA256,
  );
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
  const profile = validateRelayServicesV3Profile();
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

function validateRecoveryResourceChanges(plan, profile) {
  if (!Array.isArray(plan.resource_changes)) {
    reject('Terraform relay-services recovery changes are missing');
  }
  const expectedActions = {
    'google_cloud_run_v2_service.relay["relay-a"]': ['create'],
    'google_cloud_run_v2_service.relay["relay-b"]': ['create'],
    'google_service_account.relay["runtime"]': ['no-op'],
    'terraform_data.deployment_guard["active"]': ['update'],
  };
  const byAddress = new Map();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string'
      || byAddress.has(change.address) || expectedActions[change.address] === undefined) {
      reject('Terraform relay-services recovery contains an unreviewed resource change');
    }
    byAddress.set(change.address, change);
    exact(change.mode, 'managed', `${change.address}.mode`);
    exact(change.type, PLANNED_RESOURCES[change.address], `${change.address}.type`);
    exact(
      change.provider_name,
      change.type === 'terraform_data' ? TERRAFORM_PROVIDER : GOOGLE_PROVIDER,
      `${change.address}.provider`,
    );
    exact(change.change?.actions, expectedActions[change.address], `${change.address}.actions`);
    if (change.change?.importing !== undefined) {
      reject('Terraform relay-services recovery contains an import');
    }
  }
  exact([...byAddress.keys()].sort(), Object.keys(expectedActions).sort(), 'Terraform recovery resources');
  for (const service of profile.services) {
    const change = byAddress.get(
      `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`,
    );
    exact(change.change.before, null, `${change.address}.before`);
    validateRelay(change, service, profile);
  }

  const serviceAccount = byAddress.get('google_service_account.relay["runtime"]');
  if (!plainObject(serviceAccount.change.before)
    || !isDeepStrictEqual(serviceAccount.change.before, serviceAccount.change.after)) {
    reject('Existing relay service account must remain an exact no-op');
  }
  validateServiceAccount(serviceAccount, profile);

  const guard = byAddress.get('terraform_data.deployment_guard["active"]');
  if (!plainObject(guard.change.before) || !plainObject(guard.change.after)
    || typeof guard.change.before.id !== 'string' || guard.change.before.id.length < 16
    || guard.change.before.id !== guard.change.after.id) {
    reject('Existing relay deployment guard identity is invalid');
  }
  const previousProfile = validateRelayServicesV3Profile();
  const previousInput = guardInput(previousProfile, RELAY_SERVICES_V3_PROFILE_SHA256);
  exact(guard.change.before.input, previousInput, 'Previous relay deployment guard input');
  exact(guard.change.before.output, previousInput, 'Previous relay deployment guard output');
  exact(guard.change.before.triggers_replace, null, 'Previous relay deployment guard replacement');
  validateGuard(guard, profile, RELAY_SERVICES_V4_PROFILE_SHA256);
}

function validateRecoveryPriorState(plan) {
  const root = plan.prior_state?.values?.root_module;
  if (!plainObject(root) || root.child_modules !== undefined || !Array.isArray(root.resources)) {
    reject('Terraform recovery prior state must contain one flat reviewed root module');
  }
  const expected = {
    'data.terraform_remote_state.workload[0]': ['data', 'terraform_remote_state', TERRAFORM_PROVIDER],
    'google_service_account.relay["runtime"]': ['managed', 'google_service_account', GOOGLE_PROVIDER],
    'terraform_data.deployment_guard["active"]': ['managed', 'terraform_data', TERRAFORM_PROVIDER],
  };
  const resources = new Map();
  for (const resource of root.resources) {
    if (!plainObject(resource) || typeof resource.address !== 'string'
      || resources.has(resource.address) || expected[resource.address] === undefined) {
      reject('Terraform recovery prior state contains an unreviewed resource');
    }
    resources.set(resource.address, resource);
    const [mode, type, provider] = expected[resource.address];
    exact(resource.mode, mode, `${resource.address}.prior mode`);
    exact(resource.type, type, `${resource.address}.prior type`);
    exact(resource.provider_name, provider, `${resource.address}.prior provider`);
  }
  exact([...resources.keys()].sort(), Object.keys(expected).sort(), 'Terraform recovery prior resources');
}

export function validateRecoveryRelayServicesPlan(plan) {
  const profile = validateRelayServicesV4Profile();
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true || plan.complete !== true || plan.errored !== false
    || plan.resource_drift !== undefined) {
    reject('Terraform relay-services recovery plan format or version is invalid');
  }
  rejectForbiddenValues(plan.variables);
  rejectForbiddenValues(plan.resource_changes);
  rejectForbiddenValues(plan.planned_values);
  exact(plan.variables, Object.fromEntries(Object.entries(bootstrapRelayVariables(profile))
    .map(([name, value]) => [name, { value }])), 'Terraform relay-services recovery variables');
  validateConfiguration(plan);
  validateRecoveryResourceChanges(plan, profile);
  validatePlannedValues(plan);
  validateRecoveryPriorState(plan);
  validateChecks(plan);
  return Object.freeze({
    create: 2,
    update: 1,
    no_op: 1,
    delete: 0,
    replace: 0,
    import: 0,
    relay_services: 2,
    service_accounts_created: 0,
    service_accounts_unchanged: 1,
    public_iam_members: 0,
    live_requests: 0,
    resource_addresses: Object.freeze(Object.keys(PLANNED_RESOURCES).sort()),
  });
}

export function readAndValidateRecoveryRelayServicesPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform relay-services recovery plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform relay-services recovery plan JSON is invalid');
  }
  return validateRecoveryRelayServicesPlan(plan);
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

function differencePaths(before, after, path = '', differences = []) {
  if (isDeepStrictEqual(before, after)) return differences;
  const beforeObject = plainObject(before);
  const afterObject = plainObject(after);
  if (beforeObject && afterObject) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      differencePaths(before[key], after[key], path === '' ? key : `${path}.${key}`, differences);
    }
    return differences;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    before.forEach((entry, index) => {
      differencePaths(entry, after[index], `${path}[${index}]`, differences);
    });
    return differences;
  }
  differences.push(path);
  return differences;
}

function validateReadyServiceSnapshot(value, service, profile, audience, description) {
  if (!plainObject(value) || !Array.isArray(value.template) || value.template.length !== 1
    || !Array.isArray(value.template[0].containers)
    || value.template[0].containers.length !== 1) {
    reject(`${description} is malformed`);
  }
  const template = value.template[0];
  const container = template.containers[0];
  exact(value.project, PROJECT_ID, `${description}.project`);
  exact(value.location, REGION, `${description}.location`);
  exact(value.name, service.name, `${description}.name`);
  exact(value.ingress, profile.cloud_run.ingress, `${description}.ingress`);
  exact(value.labels, {
    component: 'browser-relay',
    environment: 'staging',
    'managed-by': 'terraform',
    product: 'miakapp-v4',
    relay: service.id,
  }, `${description}.labels`);
  exact(value.deletion_protection, false, `${description}.deletion_protection`);
  exact(value.default_uri_disabled, false, `${description}.default_uri_disabled`);
  exact(value.invoker_iam_disabled, false, `${description}.invoker_iam_disabled`);
  exact(value.iap_enabled, false, `${description}.iap_enabled`);
  exact(value.launch_stage, 'GA', `${description}.launch_stage`);
  exact(value.binary_authorization, [], `${description}.binary_authorization`);
  exact(value.annotations, {}, `${description}.annotations`);
  exact(value.build_config, [], `${description}.build_config`);
  exact(value.custom_audiences, [], `${description}.custom_audiences`);
  exact(value.tags, null, `${description}.tags`);
  exact(template.execution_environment, profile.cloud_run.execution_environment,
    `${description}.execution_environment`);
  exact(template.service_account, profile.runtime_identity.email, `${description}.service_account`);
  exact(template.max_instance_request_concurrency, profile.cloud_run.concurrency,
    `${description}.concurrency`);
  exact(template.scaling, [{
    max_instance_count: profile.cloud_run.maximum_instances,
    min_instance_count: profile.cloud_run.minimum_instances,
  }], `${description}.scaling`);
  exact(template.timeout, `${profile.cloud_run.request_timeout_seconds}s`, `${description}.timeout`);
  exact(template.session_affinity, false, `${description}.session_affinity`);
  exact(template.volumes, [], `${description}.volumes`);
  exact(template.vpc_access, [], `${description}.vpc_access`);
  exact(template.annotations, {}, `${description}.template.annotations`);
  exact(container.name, 'relay', `${description}.container.name`);
  exact(container.image, profile.image.digest_reference, `${description}.container.image`);
  exact(container.command, [], `${description}.container.command`);
  exact(container.args, [], `${description}.container.args`);
  exact(container.depends_on, [], `${description}.container.depends_on`);
  exact(container.volume_mounts, [], `${description}.container.volume_mounts`);
  exact(container.ports, [{ container_port: profile.cloud_run.port, name: 'http1' }],
    `${description}.container.ports`);
  exact(container.resources, [{
    cpu_idle: true,
    limits: { cpu: profile.cloud_run.cpu, memory: profile.cloud_run.memory },
    startup_cpu_boost: false,
  }], `${description}.container.resources`);
  exact(container.startup_probe, [{
    failure_threshold: 10,
    grpc: [],
    http_get: [{ http_headers: [], path: '/ping', port: profile.cloud_run.port }],
    initial_delay_seconds: 0,
    period_seconds: 2,
    tcp_socket: [],
    timeout_seconds: 2,
  }], `${description}.container.startup_probe`);
  const environment = expectedEnvironment(profile, service);
  environment.MIAKAPP_RELAY_AUDIENCE = audience;
  exact(normalizeEnvironment(container.env, description), environment, `${description}.environment`);
  exact(value.traffic, [{
    percent: 100,
    revision: '',
    tag: '',
    type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
  }], `${description}.traffic`);
}

function validateReadyResourceDrift(plan, profile) {
  if (!Array.isArray(plan.resource_drift) || plan.resource_drift.length !== 2) {
    reject('Terraform private-ready plan must contain the two reviewed refresh normalizations');
  }
  const expectedPaths = [
    'annotations',
    'custom_audiences',
    'template[0].annotations',
    'template[0].containers[0].args',
    'template[0].containers[0].command',
    'template[0].containers[0].depends_on',
  ];
  const byAddress = new Map(plan.resource_drift.map((change) => [change.address, change]));
  if (byAddress.size !== 2) reject('Terraform private-ready refresh contains duplicate resources');
  for (const service of profile.services) {
    const address = `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`;
    const change = byAddress.get(address);
    if (!plainObject(change) || change.mode !== 'managed'
      || change.type !== 'google_cloud_run_v2_service'
      || change.provider_name !== GOOGLE_PROVIDER
      || !isDeepStrictEqual(change.change?.actions, ['update'])) {
      reject(`${address} refresh drift is not the reviewed provider normalization`);
    }
    exact(
      differencePaths(change.change.before, change.change.after).sort(),
      expectedPaths,
      `${address} refresh normalization paths`,
    );
    validateReadyServiceSnapshot(
      change.change.after,
      service,
      profile,
      service.bootstrap_audience,
      `${address}.refreshed`,
    );
  }
}

function privateReadyGuardInput(profile, profileSha256, phase, audiences) {
  return {
    deployment_phase: phase,
    profile_sha256: profileSha256,
    relay_audiences: audiences,
    relay_image: profile.image.digest_reference,
    relay_source_commit: profile.pins.miakapp_server_commit,
  };
}

function validateReadyResourceChanges(plan, profile) {
  const expectedActions = {
    'google_cloud_run_v2_service.relay["relay-a"]': ['update'],
    'google_cloud_run_v2_service.relay["relay-b"]': ['update'],
    'google_service_account.relay["runtime"]': ['no-op'],
    'terraform_data.deployment_guard["active"]': ['update'],
  };
  if (!Array.isArray(plan.resource_changes)) reject('Private-ready resource changes are missing');
  const byAddress = new Map();
  for (const change of plan.resource_changes) {
    if (!plainObject(change) || typeof change.address !== 'string'
      || byAddress.has(change.address) || expectedActions[change.address] === undefined) {
      reject('Private-ready plan contains an unreviewed resource change');
    }
    byAddress.set(change.address, change);
    exact(change.mode, 'managed', `${change.address}.mode`);
    exact(change.type, PLANNED_RESOURCES[change.address], `${change.address}.type`);
    exact(change.provider_name,
      change.type === 'terraform_data' ? TERRAFORM_PROVIDER : GOOGLE_PROVIDER,
      `${change.address}.provider`);
    exact(change.change?.actions, expectedActions[change.address], `${change.address}.actions`);
    if (change.change?.importing !== undefined) reject('Private-ready plan contains an import');
  }
  exact([...byAddress.keys()].sort(), Object.keys(expectedActions).sort(),
    'Private-ready resource addresses');
  for (const service of profile.services) {
    const address = `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`;
    const change = byAddress.get(address);
    validateReadyServiceSnapshot(
      change.change.before,
      service,
      profile,
      service.bootstrap_audience,
      `${address}.before`,
    );
    validateReadyServiceSnapshot(
      change.change.after,
      service,
      profile,
      service.ready_audience,
      `${address}.after`,
    );
    exact(
      differencePaths(change.change.before, change.change.after).sort(),
      ['template[0].containers[0].env[16].value'],
      `${address} private-ready changes`,
    );
  }
  const serviceAccount = byAddress.get('google_service_account.relay["runtime"]');
  if (!plainObject(serviceAccount.change.before)
    || !isDeepStrictEqual(serviceAccount.change.before, serviceAccount.change.after)) {
    reject('Private-ready runtime identity must remain an exact no-op');
  }
  validateServiceAccount(serviceAccount, profile);
  const guard = byAddress.get('terraform_data.deployment_guard["active"]');
  const previous = validateRelayServicesV4Profile();
  const previousInput = privateReadyGuardInput(
    previous,
    RELAY_SERVICES_V4_PROFILE_SHA256,
    'private_bootstrap',
    bootstrapRelayVariables(previous).relay_audiences,
  );
  const nextInput = privateReadyGuardInput(
    profile,
    RELAY_SERVICES_V5_PROFILE_SHA256,
    'private_ready',
    privateReadyRelayVariables(profile).relay_audiences,
  );
  if (!plainObject(guard.change.before) || !plainObject(guard.change.after)
    || typeof guard.change.before.id !== 'string' || guard.change.before.id.length < 16
    || guard.change.before.id !== guard.change.after.id) {
    reject('Private-ready deployment guard identity is invalid');
  }
  exact(guard.change.before.input, previousInput, 'Private-ready previous guard input');
  exact(guard.change.before.output, previousInput, 'Private-ready previous guard output');
  exact(guard.change.before.triggers_replace, null, 'Private-ready previous guard replacement');
  exact(guard.change.after.input, nextInput, 'Private-ready next guard input');
  exact(guard.change.after.triggers_replace, null, 'Private-ready next guard replacement');
}

function validateReadyPriorState(plan) {
  const root = plan.prior_state?.values?.root_module;
  if (!plainObject(root) || root.child_modules !== undefined || !Array.isArray(root.resources)) {
    reject('Private-ready prior state must contain one flat reviewed root module');
  }
  const expected = {
    'data.terraform_remote_state.workload[0]': ['data', 'terraform_remote_state', TERRAFORM_PROVIDER],
    'google_cloud_run_v2_service.relay["relay-a"]': ['managed', 'google_cloud_run_v2_service', GOOGLE_PROVIDER],
    'google_cloud_run_v2_service.relay["relay-b"]': ['managed', 'google_cloud_run_v2_service', GOOGLE_PROVIDER],
    'google_service_account.relay["runtime"]': ['managed', 'google_service_account', GOOGLE_PROVIDER],
    'terraform_data.deployment_guard["active"]': ['managed', 'terraform_data', TERRAFORM_PROVIDER],
  };
  const resources = new Map(root.resources.map((resource) => [resource.address, resource]));
  if (resources.size !== root.resources.length) reject('Private-ready prior state has duplicates');
  exact([...resources.keys()].sort(), Object.keys(expected).sort(), 'Private-ready prior resources');
  for (const [address, [mode, type, provider]] of Object.entries(expected)) {
    const resource = resources.get(address);
    exact(resource.mode, mode, `${address}.prior mode`);
    exact(resource.type, type, `${address}.prior type`);
    exact(resource.provider_name, provider, `${address}.prior provider`);
  }
}

function validateReadyChecks(plan) {
  if (!Array.isArray(plan.checks)) reject('Private-ready checks are missing');
  const expected = Object.fromEntries(Object.entries(EXPECTED_CHECKS).map(([address, check]) => [
    address,
    {
      status: 'pass',
      instances: Object.fromEntries(Object.keys(check.instances).map((instance) => [instance, 'pass'])),
    },
  ]));
  const observed = {};
  for (const check of plan.checks) {
    const address = check.address?.to_display;
    if (typeof address !== 'string' || observed[address] !== undefined
      || expected[address] === undefined || !Array.isArray(check.instances)) {
      reject('Private-ready plan contains an unreviewed check');
    }
    observed[address] = {
      status: check.status,
      instances: Object.fromEntries(check.instances.map((instance) => [
        instance.address?.to_display,
        instance.status,
      ])),
    };
  }
  exact(observed, expected, 'Private-ready Terraform checks');
}

export function validatePrivateReadyRelayServicesPlan(plan) {
  const profile = validateRelayServicesV5Profile();
  if (!plainObject(plan) || plan.format_version !== '1.2'
    || plan.terraform_version !== TERRAFORM_VERSION
    || plan.applyable !== true || plan.complete !== true || plan.errored !== false) {
    reject('Terraform private-ready plan format or version is invalid');
  }
  rejectForbiddenValues(plan.variables);
  rejectForbiddenValues(plan.resource_changes);
  rejectForbiddenValues(plan.planned_values);
  rejectForbiddenValues(plan.resource_drift);
  exact(plan.variables, Object.fromEntries(Object.entries(privateReadyRelayVariables(profile))
    .map(([name, value]) => [name, { value }])), 'Terraform private-ready variables');
  validateConfiguration(plan);
  validateReadyResourceDrift(plan, profile);
  validateReadyResourceChanges(plan, profile);
  validatePlannedValues(plan);
  validateReadyPriorState(plan);
  validateReadyChecks(plan);
  return Object.freeze({
    create: 0,
    update: 3,
    no_op: 1,
    delete: 0,
    replace: 0,
    import: 0,
    relay_services_updated: 2,
    service_accounts_unchanged: 1,
    provider_refresh_normalizations: 2,
    public_iam_members: 0,
    live_requests: 0,
    resource_addresses: Object.freeze(Object.keys(PLANNED_RESOURCES).sort()),
  });
}

export function readAndValidatePrivateReadyRelayServicesPlan(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
    reject('Terraform private-ready plan JSON size is invalid');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('Terraform private-ready plan JSON is invalid');
  }
  return validatePrivateReadyRelayServicesPlan(plan);
}
