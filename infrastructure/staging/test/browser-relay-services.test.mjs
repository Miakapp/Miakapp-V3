import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  RELAY_SERVICES_PROFILE_SHA256,
  RELAY_SERVICES_TERRAFORM_SOURCE_FILES,
  RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256,
  RELAY_SERVICES_V1_PROFILE_SHA256,
  RELAY_SERVICES_V2_PROFILE_SHA256,
  RELAY_SERVICES_V3_PROFILE_SHA256,
  StagingRelayServicesProfileError,
  bootstrapRelayVariables,
  buildRelayServicesBootstrapPlanMetadata,
  buildRelayServicesRecoveryPlanMetadata,
  canonicalJson,
  relayServicesBootstrapAuthorization,
  relayServicesRecoveryAuthorization,
  relayServicesTerraformSourceSha256,
  validateRelayServicesBootstrapAuthorization,
  validateRelayServicesBootstrapFailure,
  validateRelayServicesBootstrapPlanMetadata,
  validateRelayServicesProfile,
  validateRelayServicesRecoveryAuthorization,
  validateRelayServicesRecoveryPlanMetadata,
  validateRelayServicesV1Profile,
  validateRelayServicesV2Profile,
  validateRelayServicesV3Profile,
} from '../browser-relay-services/contract.mjs';
import {
  ALLOWED_RELAY_SERVICE_FILES,
  ALLOWED_RELAY_SERVICE_TEST_FILES,
  validateRelayServicesRoot,
} from '../browser-relay-services/guard.mjs';
import {
  buildRelayBootstrapClaim,
  createRelayBootstrapClaim,
  observePinnedRelayBootstrapClaim,
  observeRelayBootstrapClaimAbsent,
  relayBootstrapClaimAbsence,
  validateRelayBootstrapClaim,
  validateRelayBootstrapClaimReceipt,
} from '../browser-relay-services/claim.mjs';
import {
  buildRelayRecoveryClaim,
  createRelayRecoveryClaim,
  observePinnedOriginalRelayBootstrapClaim,
  observePinnedRelayRecoveryClaim,
  observeRelayRecoveryClaimAbsent,
  relayRecoveryClaimAbsence,
  validateRelayRecoveryClaim,
  validateRelayRecoveryClaimReceipt,
} from '../browser-relay-services/recovery-claim.mjs';
import {
  validateRelayServicesBootstrapBaseline,
  validateRelayServicesPrivateBootstrapInventory,
  validateRelayServicesRecoveredInventory,
  validateRelayServicesRecoveryBaseline,
} from '../browser-relay-services/inventory.mjs';
import {
  buildRelayServicesRecoveryResult,
} from '../browser-relay-services/recovery-apply.mjs';
import {
  validateRelayServicesTerraformOutput,
} from '../browser-relay-services/apply.mjs';
import {
  validateInitialRelayServicesPlan,
  validateRecoveryRelayServicesPlan,
} from '../browser-relay-services/validate-plan.mjs';

const rootUrl = new URL('../browser-relay-services/', import.meta.url);
const profileUrl = new URL('profile.json', rootUrl);

function withTemporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-relay-services-test-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeProfile(directory, mutate) {
  const profile = JSON.parse(readFileSync(profileUrl, 'utf8'));
  mutate(profile);
  const path = join(directory, 'profile.json');
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function createGuardFixture(directory) {
  for (const name of ALLOWED_RELAY_SERVICE_FILES) {
    copyFileSync(new URL(name, rootUrl), join(directory, name));
    chmodSync(join(directory, name), name.endsWith('.sh') ? 0o700 : 0o600);
  }
  mkdirSync(join(directory, 'tests'));
  for (const name of ALLOWED_RELAY_SERVICE_TEST_FILES) {
    copyFileSync(new URL(`tests/${name}`, rootUrl), join(directory, 'tests', name));
    chmodSync(join(directory, 'tests', name), 0o600);
  }
}

function bootstrapBaseline() {
  const profile = validateRelayServicesV3Profile();
  return {
    schema: 'miakapp.staging-browser-relay-services-inventory/1',
    project_id: profile.project_id,
    region: profile.region,
    cloud_run_services: ['control-plane'],
    relays: [],
    relay_service_account: {
      schema: 'miakapp.staging-browser-relay-service-account-observation/1',
      email: profile.runtime_identity.email,
      state: 'absent',
    },
    relay_project_roles: [],
    terraform_state: {
      schema: 'miakapp.staging-browser-relay-services-state-observation/1',
      bucket: profile.state_backend.bucket,
      object: profile.operation.state_object,
      state: 'present',
      generation: profile.operation.initial_state_generation,
      size_bytes: profile.operation.initial_state_size_bytes,
      sha256: profile.operation.initial_state_sha256,
      terraform_version: '1.11.3',
      serial: profile.operation.initial_state_serial,
      lineage_sha256: profile.operation.initial_state_lineage_sha256,
      resource_addresses: [],
      output_names: [],
    },
    operation_claim: {
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: profile.operation.claim_bucket,
      object: profile.operation.claim_object,
      state: 'absent',
    },
  };
}

function relayAfter(service, profile) {
  const environment = {
    MIAKAPP_ALLOWED_ORIGINS: profile.application.allowed_origin,
    MIAKAPP_CONNECTION_ATTEMPTS_PER_MINUTE: '32',
    MIAKAPP_CONTROL_PLANE_ISSUER: profile.control_plane.issuer,
    MIAKAPP_CONTROL_PLANE_JWKS_URL: profile.control_plane.jwks_url,
    MIAKAPP_DECLARATION_TIMEOUT: '30s',
    MIAKAPP_DISCONNECT_GRACE: '30s',
    MIAKAPP_HANDSHAKE_TIMEOUT: '5s',
    MIAKAPP_LISTEN_ADDRESS: ':3000',
    MIAKAPP_MAX_AGGREGATE_QUEUED_BYTES: '4194304',
    MIAKAPP_MAX_CONNECTIONS: '8',
    MIAKAPP_MAX_CONNECTIONS_PER_IP: '8',
    MIAKAPP_MAX_HOMES: '16',
    MIAKAPP_MAX_QUEUED_BYTES: '262144',
    MIAKAPP_MAX_TRACKED_IPS: '64',
    MIAKAPP_PING_INTERVAL: '30s',
    MIAKAPP_PONG_TIMEOUT: '10s',
    MIAKAPP_RELAY_AUDIENCE: service.bootstrap_audience,
    MIAKAPP_SHUTDOWN_TIMEOUT: '10s',
    MIAKAPP_WRITE_TIMEOUT: '5s',
  };
  return {
    project: profile.project_id,
    location: profile.region,
    name: service.name,
    ingress: profile.cloud_run.ingress,
    labels: {
      component: 'browser-relay',
      environment: 'staging',
      'managed-by': 'terraform',
      product: 'miakapp-v4',
      relay: service.id,
    },
    deletion_protection: false,
    default_uri_disabled: false,
    invoker_iam_disabled: false,
    iap_enabled: false,
    launch_stage: 'GA',
    binary_authorization: [{
      breakglass_justification: null,
      policy: null,
      use_default: false,
    }],
    build_config: [],
    custom_audiences: null,
    tags: null,
    template: [{
      execution_environment: profile.cloud_run.execution_environment,
      service_account: profile.runtime_identity.email,
      max_instance_request_concurrency: 8,
      scaling: [{ max_instance_count: 1, min_instance_count: 0 }],
      timeout: '900s',
      session_affinity: false,
      volumes: [],
      vpc_access: [],
      encryption_key: null,
      containers: [{
        name: 'relay',
        image: profile.image.digest_reference,
        command: null,
        args: null,
        volume_mounts: [],
        ports: [{ container_port: 3000, name: 'http1' }],
        resources: [{
          cpu_idle: true,
          limits: { cpu: '1', memory: profile.cloud_run.memory },
          startup_cpu_boost: false,
        }],
        startup_probe: [{
          failure_threshold: 10,
          grpc: [],
          http_get: [{ http_headers: [], path: '/ping', port: 3000 }],
          initial_delay_seconds: 0,
          period_seconds: 2,
          tcp_socket: [],
          timeout_seconds: 2,
        }],
        liveness_probe: [],
        readiness_probe: [],
        env: Object.entries(environment).map(([name, value]) => ({
          name,
          value,
          value_source: [],
        })),
      }],
    }],
    traffic: [{
      percent: 100,
      revision: null,
      tag: null,
      type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
    }],
  };
}

function validPlan() {
  const profile = validateRelayServicesV3Profile();
  const configurations = [
    ['google_cloud_run_v2_service.relay', 'managed', 'google_cloud_run_v2_service', 'google'],
    ['google_cloud_run_v2_service_iam_member.public', 'managed', 'google_cloud_run_v2_service_iam_member', 'google'],
    ['google_service_account.relay', 'managed', 'google_service_account', 'google'],
    ['terraform_data.deployment_guard', 'managed', 'terraform_data', 'terraform'],
    ['data.terraform_remote_state.workload', 'data', 'terraform_remote_state', 'terraform'],
  ].map(([address, mode, type, provider_config_key]) => ({
    address,
    mode,
    type,
    provider_config_key,
  }));
  const changes = profile.services.map((service) => ({
    address: `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`,
    mode: 'managed',
    type: 'google_cloud_run_v2_service',
    provider_name: 'registry.terraform.io/hashicorp/google',
    change: { actions: ['create'], before: null, after: relayAfter(service, profile) },
  }));
  changes.push({
    address: 'google_service_account.relay["runtime"]',
    mode: 'managed',
    type: 'google_service_account',
    provider_name: 'registry.terraform.io/hashicorp/google',
    change: {
      actions: ['create'],
      before: null,
      after: {
        project: profile.project_id,
        account_id: profile.runtime_identity.account_id,
        email: profile.runtime_identity.email,
        member: `serviceAccount:${profile.runtime_identity.email}`,
        disabled: false,
        deletion_policy: 'DELETE',
        create_ignore_already_exists: null,
      },
    },
  }, {
    address: 'terraform_data.deployment_guard["active"]',
    mode: 'managed',
    type: 'terraform_data',
    provider_name: 'terraform.io/builtin/terraform',
    change: {
      actions: ['create'],
      before: null,
      after: {
        input: {
          deployment_phase: 'private_bootstrap',
          profile_sha256: RELAY_SERVICES_V3_PROFILE_SHA256,
          relay_audiences: bootstrapRelayVariables(profile).relay_audiences,
          relay_image: profile.image.digest_reference,
          relay_source_commit: profile.pins.miakapp_server_commit,
        },
        triggers_replace: null,
      },
    },
  });
  return {
    format_version: '1.2',
    terraform_version: '1.11.3',
    applyable: true,
    complete: true,
    errored: false,
    variables: Object.fromEntries(Object.entries(bootstrapRelayVariables(profile))
      .map(([name, value]) => [name, { value }])),
    configuration: {
      provider_config: {
        google: {
          full_name: 'registry.terraform.io/hashicorp/google',
          version_constraint: '8.1.0',
        },
        terraform: { full_name: 'terraform.io/builtin/terraform' },
      },
      root_module: { resources: configurations },
    },
    resource_changes: changes,
    planned_values: {
      outputs: { staging_browser_relays: { sensitive: false } },
      root_module: {
        resources: changes.map(({ address, mode, type }) => ({ address, mode, type })),
      },
    },
    prior_state: {
      values: {
        root_module: {
          resources: [{
            address: 'data.terraform_remote_state.workload[0]',
            mode: 'data',
            type: 'terraform_remote_state',
            provider_name: 'terraform.io/builtin/terraform',
          }],
        },
      },
    },
    checks: [
      ['google_cloud_run_v2_service.relay', 'unknown', [
        ['google_cloud_run_v2_service.relay["relay-a"]', 'unknown'],
        ['google_cloud_run_v2_service.relay["relay-b"]', 'unknown'],
      ]],
      ['terraform_data.deployment_guard', 'pass', [
        ['terraform_data.deployment_guard["active"]', 'pass'],
      ]],
      ['var.deployment_phase', 'pass', [['var.deployment_phase', 'pass']]],
      ['var.relay_audiences', 'pass', [['var.relay_audiences', 'pass']]],
    ].map(([address, status, instances]) => ({
      address: { to_display: address },
      status,
      instances: instances.map(([instanceAddress, instanceStatus]) => ({
        address: { to_display: instanceAddress },
        status: instanceStatus,
      })),
    })),
  };
}

function validPlanMetadata(now = Date.now()) {
  const baseline = validateRelayServicesBootstrapBaseline(bootstrapBaseline());
  const planBytes = Buffer.from('reviewed binary plan');
  const planJsonBytes = Buffer.from('{"reviewed":true}\n');
  const variablesBytes = Buffer.from(canonicalJson(bootstrapRelayVariables(
    validateRelayServicesV3Profile(),
  )));
  const repositoryCommit = 'a'.repeat(40);
  const summary = validateInitialRelayServicesPlan(validPlan());
  const metadata = buildRelayServicesBootstrapPlanMetadata({
    repositoryCommit,
    createdAt: new Date(now).toISOString(),
    planBytes,
    planJsonBytes,
    variablesBytes,
    baseline,
    summary,
  });
  return { metadata, metadataBytes: Buffer.from(canonicalJson(metadata)), planBytes };
}

function recoveryBaseline() {
  const profile = validateRelayServicesProfile();
  return {
    schema: 'miakapp.staging-browser-relay-services-inventory/2',
    project_id: profile.project_id,
    region: profile.region,
    cloud_run_services: ['control-plane'],
    relays: [],
    relay_service_account: {
      schema: 'miakapp.staging-browser-relay-service-account-observation/1',
      email: profile.runtime_identity.email,
      name: `projects/${profile.project_id}/serviceAccounts/${profile.runtime_identity.email}`,
      state: 'active',
      user_managed_keys: 0,
    },
    relay_project_roles: [],
    terraform_state: {
      schema: 'miakapp.staging-browser-relay-services-state-observation/1',
      bucket: profile.state_backend.bucket,
      object: profile.operation.state_object,
      state: 'present',
      generation: profile.operation.initial_state_generation,
      size_bytes: profile.operation.initial_state_size_bytes,
      sha256: profile.operation.initial_state_sha256,
      terraform_version: '1.11.3',
      serial: profile.operation.initial_state_serial,
      lineage_sha256: profile.operation.initial_state_lineage_sha256,
      resource_addresses: [
        'data.terraform_remote_state.workload[0]',
        'google_service_account.relay["runtime"]',
        'terraform_data.deployment_guard["active"]',
      ],
      output_names: [],
    },
    bootstrap_claim: {
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: profile.operation.claim_bucket,
      object: profile.operation.original_claim_object,
      state: 'present',
      generation: profile.operation.original_claim_generation,
      size_bytes: profile.operation.original_claim_size_bytes,
    },
    recovery_claim: {
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: profile.operation.claim_bucket,
      object: profile.operation.claim_object,
      state: 'absent',
    },
  };
}

function validRecoveryPlan() {
  const plan = validPlan();
  const profile = validateRelayServicesProfile();
  const previous = validateRelayServicesV3Profile();
  const guardInput = (value, digest) => ({
    deployment_phase: 'private_bootstrap',
    profile_sha256: digest,
    relay_audiences: bootstrapRelayVariables(value).relay_audiences,
    relay_image: value.image.digest_reference,
    relay_source_commit: value.pins.miakapp_server_commit,
  });
  plan.variables = Object.fromEntries(Object.entries(bootstrapRelayVariables(profile))
    .map(([name, value]) => [name, { value }]));
  for (const service of profile.services) {
    const change = plan.resource_changes.find(
      ({ address }) => address === `google_cloud_run_v2_service.relay[${JSON.stringify(service.id)}]`,
    );
    change.change.after = relayAfter(service, profile);
  }
  const serviceAccount = plan.resource_changes.find(
    ({ address }) => address === 'google_service_account.relay["runtime"]',
  );
  serviceAccount.change.actions = ['no-op'];
  serviceAccount.change.before = structuredClone(serviceAccount.change.after);
  const guard = plan.resource_changes.find(
    ({ address }) => address === 'terraform_data.deployment_guard["active"]',
  );
  const id = '9a62fa34-aba6-81c8-06d4-4ca5506239ba';
  guard.change.actions = ['update'];
  guard.change.before = {
    id,
    input: guardInput(previous, RELAY_SERVICES_V3_PROFILE_SHA256),
    output: guardInput(previous, RELAY_SERVICES_V3_PROFILE_SHA256),
    triggers_replace: null,
  };
  guard.change.after = {
    id,
    input: guardInput(profile, RELAY_SERVICES_PROFILE_SHA256),
    triggers_replace: null,
  };
  plan.prior_state.values.root_module.resources.push({
    address: 'google_service_account.relay["runtime"]',
    mode: 'managed',
    type: 'google_service_account',
    provider_name: 'registry.terraform.io/hashicorp/google',
  }, {
    address: 'terraform_data.deployment_guard["active"]',
    mode: 'managed',
    type: 'terraform_data',
    provider_name: 'terraform.io/builtin/terraform',
  });
  return plan;
}

function validRecoveryMetadata(now = Date.now()) {
  const baseline = validateRelayServicesRecoveryBaseline(recoveryBaseline());
  const planBytes = Buffer.from('reviewed recovery binary plan');
  const planJsonBytes = Buffer.from('{"reviewed_recovery":true}\n');
  const variablesBytes = Buffer.from(canonicalJson(bootstrapRelayVariables()));
  const repositoryCommit = 'b'.repeat(40);
  const summary = validateRecoveryRelayServicesPlan(validRecoveryPlan());
  const metadata = buildRelayServicesRecoveryPlanMetadata({
    repositoryCommit,
    createdAt: new Date(now).toISOString(),
    planBytes,
    planJsonBytes,
    variablesBytes,
    baseline,
    summary,
  });
  return { metadata, metadataBytes: Buffer.from(canonicalJson(metadata)), planBytes };
}

function privateBootstrapInventory() {
  const profile = validateRelayServicesV3Profile();
  const relays = profile.services.map((service, index) => {
    const after = relayAfter(service, profile);
    const container = after.template[0].containers[0];
    return {
      id: service.id,
      name: service.name,
      resource_name: `projects/${profile.project_id}/locations/${profile.region}/services/${service.name}`,
      uri: `https://${service.name}-${index === 0 ? 'abcdefghij' : 'klmnopqrst'}-od.a.run.app`,
      generation: '1',
      ingress: profile.cloud_run.ingress,
      labels: after.labels,
      service_account: profile.runtime_identity.email,
      execution_environment: profile.cloud_run.execution_environment,
      minimum_instances: 0,
      maximum_instances: 1,
      concurrency: 8,
      timeout: '900s',
      session_affinity: false,
      container: {
        name: 'relay',
        image: profile.image.digest_reference,
        environment: Object.fromEntries(container.env.map(({ name, value }) => [name, value])),
        ports: [{ name: 'http1', container_port: 3000 }],
        cpu: '1',
        memory: profile.cloud_run.memory,
        cpu_idle: true,
        startup_cpu_boost: false,
        startup_probe: {
          path: '/ping',
          port: 3000,
          initial_delay_seconds: 0,
          timeout_seconds: 2,
          period_seconds: 2,
          failure_threshold: 10,
        },
      },
      traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
      ready: true,
      reconciling: false,
      iam_bindings: [],
    };
  });
  return {
    schema: 'miakapp.staging-browser-relay-services-inventory/1',
    project_id: profile.project_id,
    region: profile.region,
    cloud_run_services: [
      'control-plane',
      'miakapp-staging-relay-a',
      'miakapp-staging-relay-b',
    ],
    relays,
    relay_service_account: {
      schema: 'miakapp.staging-browser-relay-service-account-observation/1',
      email: profile.runtime_identity.email,
      name: `projects/${profile.project_id}/serviceAccounts/${profile.runtime_identity.email}`,
      state: 'active',
      user_managed_keys: 0,
    },
    relay_project_roles: [],
    terraform_state: {
      schema: 'miakapp.staging-browser-relay-services-state-observation/1',
      bucket: profile.state_backend.bucket,
      object: profile.operation.state_object,
      state: 'present',
      generation: '1788655780811692',
      size_bytes: 4096,
      sha256: 'b'.repeat(64),
      terraform_version: '1.11.3',
      serial: 2,
      lineage_sha256: profile.operation.initial_state_lineage_sha256,
      resource_addresses: [
        'data.terraform_remote_state.workload[0]',
        'google_cloud_run_v2_service.relay["relay-a"]',
        'google_cloud_run_v2_service.relay["relay-b"]',
        'google_service_account.relay["runtime"]',
        'terraform_data.deployment_guard["active"]',
      ],
      output_names: ['staging_browser_relays'],
    },
    operation_claim: {
      schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
      bucket: profile.operation.claim_bucket,
      object: profile.operation.claim_object,
      state: 'present',
      generation: '123456789',
      size_bytes: 700,
    },
  };
}

function recoveredInventory(receipt = { generation: '223456789', size_bytes: 900 }) {
  const profile = validateRelayServicesProfile();
  const value = privateBootstrapInventory();
  value.schema = 'miakapp.staging-browser-relay-services-inventory/2';
  value.relays.forEach((relay) => {
    relay.container.memory = profile.cloud_run.memory;
  });
  value.terraform_state.generation = '1788658040492802';
  value.terraform_state.size_bytes = 16_384;
  value.terraform_state.sha256 = 'c'.repeat(64);
  value.terraform_state.serial = 3;
  value.bootstrap_claim = {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: profile.operation.claim_bucket,
    object: profile.operation.original_claim_object,
    state: 'present',
    generation: profile.operation.original_claim_generation,
    size_bytes: profile.operation.original_claim_size_bytes,
  };
  value.recovery_claim = {
    schema: 'miakapp.staging-browser-relay-services-claim-observation/1',
    bucket: profile.operation.claim_bucket,
    object: profile.operation.claim_object,
    state: 'present',
    generation: receipt.generation,
    size_bytes: receipt.size_bytes,
  };
  delete value.operation_claim;
  return value;
}

function privateBootstrapOutput(inventory = privateBootstrapInventory()) {
  const profile = validateRelayServicesProfile();
  return {
    schema: 'miakapp.staging-browser-relay-services/1',
    deployment_phase: 'private_bootstrap',
    project_id: profile.project_id,
    project_number: profile.project_number,
    region: profile.region,
    relay_source_commit: profile.pins.miakapp_server_commit,
    relay_image: profile.image.digest_reference,
    runtime_identity: profile.runtime_identity.email,
    runtime_project_roles: [],
    services: Object.fromEntries(profile.services.map((service) => {
      const observed = inventory.relays.find(({ id }) => id === service.id);
      return [service.id, {
        name: service.name,
        uri: observed.uri,
        audience: service.bootstrap_audience,
        public_invoker: false,
        minimum_instances: 0,
        maximum_instances: 1,
        concurrency: 8,
        timeout_seconds: 900,
        deletion_protection: false,
      }];
    })),
  };
}

test('validates the immutable memory-recovery relay-services profile and evidence chain', () => {
  const profile = validateRelayServicesProfile(fileURLToPath(profileUrl));
  const historical = validateRelayServicesV1Profile();
  const digestBound = validateRelayServicesV2Profile();
  const previous = validateRelayServicesV3Profile();
  const failure = validateRelayServicesBootstrapFailure();
  assert.equal(RELAY_SERVICES_PROFILE_SHA256, '0f8b966a7bf412156a83b0ddc76996abc6b49c28d81cda0f3e4d2b1c16912733');
  assert.equal(RELAY_SERVICES_V1_PROFILE_SHA256, 'bc9b231cc9724f19a26ef5c3bbd6da6a69ec79b00cb976e77c73015d5db10db7');
  assert.equal(RELAY_SERVICES_V2_PROFILE_SHA256, '26535e8c8b56d5a0a0875049a1e76aade4e1246b0808470ab4483bc01a2f48cb');
  assert.equal(RELAY_SERVICES_V3_PROFILE_SHA256, 'a5bc737620e57aed5c7e828b4d558e3b246ba13edb40944a40febba6c14a9316');
  assert.equal(RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256, 'd98eb890376d5ec0b87ad91ffc88ca93eb206794d9c0d799b4fa7f0817f9a540');
  assert.equal(profile.terraform_source_sha256, '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746');
  assert.equal(profile.pins.miakapp_server_commit, 'df10674e034f30eec80760f5ec94bc108cff026f');
  assert.equal(
    profile.image.digest_reference,
    'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server@sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1',
  );
  assert.equal(profile.contracts.historical_profile_sha256, RELAY_SERVICES_V1_PROFILE_SHA256);
  assert.equal(profile.contracts.digest_bound_profile_sha256, RELAY_SERVICES_V2_PROFILE_SHA256);
  assert.equal(profile.contracts.previous_profile_sha256, RELAY_SERVICES_V3_PROFILE_SHA256);
  assert.equal(profile.contracts.bootstrap_failure_sha256, RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256);
  assert.equal(historical.image.digest, undefined);
  assert.equal(digestBound.state, 'verified_image_bound_no_operator_entrypoint');
  assert.equal(previous.state, 'private_bootstrap_entrypoint_prepared_not_executed');
  assert.equal(failure.failure.category, 'cloud_run_gen2_memory_below_minimum');
  assert.deepEqual(profile.runtime_identity.project_roles, []);
  assert.equal(profile.cloud_run.minimum_instances, 0);
  assert.equal(profile.cloud_run.maximum_instances, 1);
  assert.equal(profile.admission.maximum_connections, 8);
  assert.equal(profile.admission.maximum_aggregate_queued_bytes, 4194304);
  assert.equal(profile.admission.forwarded_client_headers_trusted, false);
  assert.deepEqual(profile.phases, ['absent', 'private_bootstrap', 'private_ready', 'public_window']);
  assert.equal(profile.cloud_run.memory, '512Mi');
  assert.equal(profile.operation.maximum_terraform_creates, 2);
  assert.equal(profile.operation.maximum_terraform_updates, 1);
  assert.equal(profile.operation.maximum_terraform_deletes, 0);
  assert.equal(profile.operation.maximum_public_iam_members, 0);
  assert.equal(profile.operation.maximum_live_requests, 0);
  assert.equal(profile.operation.retry_authorized, false);
});

test('rejects any profile byte or safety-boundary drift', () => {
  withTemporaryDirectory((directory) => {
    for (const mutate of [
      (profile) => { profile.project_id = 'miakapp-3'; },
      (profile) => { profile.image.digest = `sha256:${'0'.repeat(64)}`; },
      (profile) => { profile.image.mutable_tags_allowed = true; },
      (profile) => { profile.runtime_identity.project_roles = ['roles/editor']; },
      (profile) => { profile.cloud_run.maximum_instances = 2; },
      (profile) => { profile.admission.maximum_connections = 9; },
      (profile) => { profile.effects.public_iam_only_in_public_window = false; },
    ]) {
      const path = writeProfile(directory, mutate);
      assert.throws(
        () => validateRelayServicesProfile(path),
        (error) => error instanceof StagingRelayServicesProfileError
          && /digest has drifted/.test(error.message),
      );
    }
  });
});

test('binds the profile to every operational Terraform source byte', () => {
  assert.equal(
    relayServicesTerraformSourceSha256(fileURLToPath(rootUrl)),
    '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746',
  );

  withTemporaryDirectory((directory) => {
    copyFileSync(profileUrl, join(directory, 'profile.json'));
    for (const name of RELAY_SERVICES_TERRAFORM_SOURCE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
    }
    validateRelayServicesProfile(join(directory, 'profile.json'));
    writeFileSync(join(directory, 'main.tf'), '\n# drift\n', { flag: 'a' });
    assert.throws(
      () => validateRelayServicesProfile(join(directory, 'profile.json')),
      (error) => error instanceof StagingRelayServicesProfileError
        && /Terraform source digest has drifted/.test(error.message),
    );
  });
});

test('removes the relay image as an operator-controlled Terraform input', () => {
  const variables = readFileSync(new URL('variables.tf', rootUrl), 'utf8');
  const main = readFileSync(new URL('main.tf', rootUrl), 'utf8');
  const foundation = readFileSync(new URL('foundation.tf', rootUrl), 'utf8');
  assert.doesNotMatch(variables, /variable "relay_image"/u);
  assert.doesNotMatch(`${main}\n${foundation}`, /var\.relay_image/u);
  assert.match(main, /image = local\.relay_image/u);
  assert.match(foundation, /local\.relay_image == local\.profile\.image\.digest_reference/u);
});

test('accepts only the closed, non-executable source inventory', () => {
  validateRelayServicesRoot(rootUrl);

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    validateRelayServicesRoot(pathToFileURL(`${directory}/`));

    writeFileSync(join(directory, 'unexpected.txt'), 'unexpected\n', { mode: 0o600 });
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /reviewed relay-services inventory/,
    );
  });

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    chmodSync(join(directory, 'main.tf'), 0o700);
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /unexpected executable permissions/,
    );
  });

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    rmSync(join(directory, 'profile.json'));
    symlinkSync(join(directory, 'README.md'), join(directory, 'profile.json'));
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /must not be a symbolic link/,
    );
  });
});

test('binds a short-lived private plan to its exact baseline and authorization', () => {
  const baseline = validateRelayServicesBootstrapBaseline(bootstrapBaseline());
  const planBytes = Buffer.from('reviewed binary plan');
  const planJsonBytes = Buffer.from('{"reviewed":true}\n');
  const variablesBytes = Buffer.from(canonicalJson(bootstrapRelayVariables()));
  const repositoryCommit = 'a'.repeat(40);
  const summary = validateInitialRelayServicesPlan(validPlan());
  const now = Date.now();
  const metadata = buildRelayServicesBootstrapPlanMetadata({
    repositoryCommit,
    createdAt: new Date(now).toISOString(),
    planBytes,
    planJsonBytes,
    variablesBytes,
    baseline,
    summary,
  });
  assert.equal(
    metadata.baseline_sha256,
    createHash('sha256').update(canonicalJson(baseline)).digest('hex'),
  );
  assert.equal(validateRelayServicesBootstrapPlanMetadata(metadata, now), metadata);
  const authorization = relayServicesBootstrapAuthorization(
    planBytes,
    repositoryCommit,
    metadata.baseline_sha256,
  );
  assert.doesNotThrow(() => validateRelayServicesBootstrapAuthorization(
    authorization,
    planBytes,
    repositoryCommit,
    metadata.baseline_sha256,
  ));
  assert.throws(() => validateRelayServicesBootstrapAuthorization(
    `${authorization}x`,
    planBytes,
    repositoryCommit,
    metadata.baseline_sha256,
  ), /authorization is missing or invalid/u);
});

test('accepts only the exact create-only private relay plan', () => {
  const summary = validateInitialRelayServicesPlan(validPlan());
  assert.deepEqual(summary, {
    create: 4,
    update: 0,
    delete: 0,
    replace: 0,
    import: 0,
    relay_services: 2,
    service_accounts: 1,
    public_iam_members: 0,
    live_requests: 0,
    resource_addresses: [
      'google_cloud_run_v2_service.relay["relay-a"]',
      'google_cloud_run_v2_service.relay["relay-b"]',
      'google_service_account.relay["runtime"]',
      'terraform_data.deployment_guard["active"]',
    ],
  });

  for (const mutate of [
    (plan) => { plan.resource_changes[0].change.actions = ['delete', 'create']; },
    (plan) => { plan.resource_changes[0].change.after.template[0].scaling[0].max_instance_count = 2; },
    (plan) => { plan.resource_changes[0].change.after.template[0].containers[0].image = 'mutable:latest'; },
    (plan) => { plan.resource_changes[0].change.after.template[0].vpc_access = [{}]; },
    (plan) => { plan.resource_changes[0].change.after.template[0].containers[0].env.push({ name: 'SECRET', value: 'x', value_source: [] }); },
    (plan) => { plan.resource_changes.push({ address: 'google_cloud_run_v2_service_iam_member.public["relay-a"]' }); },
    (plan) => { plan.variables.deployment_phase.value = 'public_window'; },
  ]) {
    const plan = validPlan();
    mutate(plan);
    assert.throws(() => validateInitialRelayServicesPlan(plan));
  }
});

test('rejects baseline drift before any relay mutation', () => {
  const baseline = bootstrapBaseline();
  assert.equal(validateRelayServicesBootstrapBaseline(baseline), baseline);
  for (const mutate of [
    (value) => { value.cloud_run_services.push('miakapp-staging-relay-a'); },
    (value) => { value.relay_service_account.state = 'active'; },
    (value) => { value.relay_project_roles.push('roles/viewer'); },
    (value) => { value.terraform_state.generation = '2'; },
    (value) => { value.operation_claim.state = 'present'; },
  ]) {
    const value = structuredClone(baseline);
    mutate(value);
    assert.throws(() => validateRelayServicesBootstrapBaseline(value));
  }
});

test('creates and verifies one generation-pinned global bootstrap claim', async () => {
  const now = Date.now();
  const { metadata, metadataBytes } = validPlanMetadata(now);
  const attemptedAt = new Date(now + 1_000).toISOString();
  const expectedClaim = buildRelayBootstrapClaim(metadataBytes, metadata, attemptedAt);
  assert.equal(validateRelayBootstrapClaim(expectedClaim, metadataBytes, metadata), expectedClaim);

  let storedBytes;
  const requests = [];
  const fetchImplementation = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.hostname !== 'storage.googleapis.com') return new Response('', { status: 500 });
    if (parsed.pathname.startsWith('/upload/storage/v1/')) {
      storedBytes = Buffer.from(options.body);
      return new Response(JSON.stringify({
        bucket: 'miakapp-v4-staging-tfstate-1072737219170',
        name: 'terraform/browser-relay-services/operations/private-bootstrap-v1.json',
        generation: '123456789',
        size: String(storedBytes.byteLength),
      }), { status: 200 });
    }
    if (parsed.searchParams.get('alt') === 'media') {
      return new Response(storedBytes, { status: 200 });
    }
    return new Response(JSON.stringify({
      bucket: 'miakapp-v4-staging-tfstate-1072737219170',
      name: 'terraform/browser-relay-services/operations/private-bootstrap-v1.json',
      generation: '123456789',
      size: String(storedBytes.byteLength),
    }), { status: 200 });
  };
  const session = { accessToken: 'a'.repeat(40) };
  const receipt = await createRelayBootstrapClaim(
    session,
    metadataBytes,
    metadata,
    attemptedAt,
    fetchImplementation,
  );
  assert.equal(
    validateRelayBootstrapClaimReceipt(receipt, metadataBytes, metadata),
    receipt,
  );
  assert.equal(receipt.generation, '123456789');
  assert.equal(requests[0].url.searchParams.get('ifGenerationMatch'), '0');
  assert.equal(requests[1].url.searchParams.get('generation'), '123456789');
  assert.equal(requests[1].url.searchParams.get('alt'), 'media');

  await observePinnedRelayBootstrapClaim(
    session,
    receipt,
    metadataBytes,
    metadata,
    fetchImplementation,
  );
  assert.equal(requests.at(-2).url.searchParams.get('generation'), '123456789');
  assert.equal(requests.at(-1).url.searchParams.get('generation'), '123456789');
});

test('treats an existing or ambiguous global claim as permanently non-retryable', async () => {
  const session = { accessToken: 'a'.repeat(40) };
  assert.deepEqual(
    await observeRelayBootstrapClaimAbsent(
      session,
      async () => new Response('', { status: 404 }),
    ),
    relayBootstrapClaimAbsence(),
  );
  await assert.rejects(
    observeRelayBootstrapClaimAbsent(
      session,
      async () => new Response('{}', { status: 200 }),
    ),
    /already exists/u,
  );
  const { metadata, metadataBytes } = validPlanMetadata();
  await assert.rejects(
    createRelayBootstrapClaim(
      session,
      metadataBytes,
      metadata,
      metadata.created_at,
      async () => { throw new Error('ambiguous transport'); },
    ),
    /outcome is unknown/u,
  );
});

test('accepts only two ready private relays with a keyless role-free identity', () => {
  const inventory = privateBootstrapInventory();
  const receipt = { generation: '123456789', size_bytes: 700 };
  assert.equal(
    validateRelayServicesPrivateBootstrapInventory(inventory, receipt),
    inventory,
  );
  assert.equal(validateRelayServicesTerraformOutput(privateBootstrapOutput(inventory)).services['relay-a'].public_invoker, false);

  for (const mutate of [
    (value) => { value.relays[0].iam_bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] }); },
    (value) => { value.relays[0].container.image = 'mutable:latest'; },
    (value) => { value.relays[0].maximum_instances = 2; },
    (value) => { value.relay_project_roles.push('roles/viewer'); },
    (value) => { value.relay_service_account.user_managed_keys = 1; },
    (value) => { value.terraform_state.lineage_sha256 = '0'.repeat(64); },
    (value) => { value.cloud_run_services.push('foreign-service'); },
  ]) {
    const value = structuredClone(inventory);
    mutate(value);
    assert.throws(() => validateRelayServicesPrivateBootstrapInventory(value, receipt));
  }
});

test('binds the distinct recovery plan to the partial state, failure and authorization', () => {
  const baseline = validateRelayServicesRecoveryBaseline(recoveryBaseline());
  const planBytes = Buffer.from('reviewed recovery binary plan');
  const planJsonBytes = Buffer.from('{"reviewed_recovery":true}\n');
  const variablesBytes = Buffer.from(canonicalJson(bootstrapRelayVariables()));
  const repositoryCommit = 'b'.repeat(40);
  const summary = validateRecoveryRelayServicesPlan(validRecoveryPlan());
  const now = Date.now();
  const metadata = buildRelayServicesRecoveryPlanMetadata({
    repositoryCommit,
    createdAt: new Date(now).toISOString(),
    planBytes,
    planJsonBytes,
    variablesBytes,
    baseline,
    summary,
  });
  assert.equal(metadata.profile_sha256, RELAY_SERVICES_PROFILE_SHA256);
  assert.equal(metadata.bootstrap_failure_sha256, RELAY_SERVICES_BOOTSTRAP_FAILURE_SHA256);
  assert.equal(metadata.original_claim_generation, '1788658024634812');
  assert.equal(metadata.maximum_terraform_creates, 2);
  assert.equal(metadata.maximum_terraform_updates, 1);
  assert.equal(metadata.maximum_terraform_deletes, 0);
  assert.equal(validateRelayServicesRecoveryPlanMetadata(metadata, now), metadata);
  const authorization = relayServicesRecoveryAuthorization(
    planBytes,
    repositoryCommit,
    metadata.baseline_sha256,
  );
  assert.doesNotThrow(() => validateRelayServicesRecoveryAuthorization(
    authorization,
    planBytes,
    repositoryCommit,
    metadata.baseline_sha256,
  ));
  assert.throws(() => validateRelayServicesRecoveryAuthorization(
    authorization,
    Buffer.from('different plan'),
    repositoryCommit,
    metadata.baseline_sha256,
  ), /authorization is missing or invalid/u);
});

test('accepts only the exact two-create one-update recovery plan', () => {
  assert.deepEqual(validateRecoveryRelayServicesPlan(validRecoveryPlan()), {
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
    resource_addresses: [
      'google_cloud_run_v2_service.relay["relay-a"]',
      'google_cloud_run_v2_service.relay["relay-b"]',
      'google_service_account.relay["runtime"]',
      'terraform_data.deployment_guard["active"]',
    ],
  });
  for (const mutate of [
    (plan) => { plan.resource_changes[0].change.actions = ['delete', 'create']; },
    (plan) => { plan.resource_changes[0].change.after.template[0].containers[0].resources[0].limits.memory = '256Mi'; },
    (plan) => { plan.resource_changes[2].change.actions = ['update']; },
    (plan) => { plan.resource_changes[3].change.before.input.profile_sha256 = RELAY_SERVICES_PROFILE_SHA256; },
    (plan) => { plan.resource_changes.push({ address: 'google_cloud_run_v2_service_iam_member.public["relay-a"]' }); },
    (plan) => { plan.prior_state.values.root_module.resources.pop(); },
    (plan) => { plan.resource_drift = []; },
  ]) {
    const plan = validRecoveryPlan();
    mutate(plan);
    assert.throws(() => validateRecoveryRelayServicesPlan(plan));
  }
});

test('rejects drift from the exact reconciled recovery baseline', () => {
  const baseline = recoveryBaseline();
  assert.equal(validateRelayServicesRecoveryBaseline(baseline), baseline);
  for (const mutate of [
    (value) => { value.cloud_run_services.push('miakapp-staging-relay-a'); },
    (value) => { value.relay_service_account.user_managed_keys = 1; },
    (value) => { value.relay_project_roles.push('roles/viewer'); },
    (value) => { value.terraform_state.generation = '1788658040492802'; },
    (value) => { value.bootstrap_claim.generation = '1788658024634813'; },
    (value) => { value.recovery_claim.state = 'present'; },
  ]) {
    const value = structuredClone(baseline);
    mutate(value);
    assert.throws(() => validateRelayServicesRecoveryBaseline(value));
  }
});

test('creates and verifies one generation-pinned global recovery claim', async () => {
  const now = Date.now();
  const { metadata, metadataBytes } = validRecoveryMetadata(now);
  const attemptedAt = new Date(now + 1_000).toISOString();
  const expectedClaim = buildRelayRecoveryClaim(metadataBytes, metadata, attemptedAt);
  assert.equal(validateRelayRecoveryClaim(expectedClaim, metadataBytes, metadata), expectedClaim);

  let storedBytes;
  const requests = [];
  const fetchImplementation = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.hostname !== 'storage.googleapis.com') return new Response('', { status: 500 });
    if (parsed.pathname.startsWith('/upload/storage/v1/')) {
      storedBytes = Buffer.from(options.body);
      return new Response(JSON.stringify({
        bucket: 'miakapp-v4-staging-tfstate-1072737219170',
        name: 'terraform/browser-relay-services/operations/private-bootstrap-memory-recovery-v1.json',
        generation: '223456789',
        size: String(storedBytes.byteLength),
      }), { status: 200 });
    }
    if (parsed.searchParams.get('alt') === 'media') {
      return new Response(storedBytes, { status: 200 });
    }
    return new Response(JSON.stringify({
      bucket: 'miakapp-v4-staging-tfstate-1072737219170',
      name: 'terraform/browser-relay-services/operations/private-bootstrap-memory-recovery-v1.json',
      generation: '223456789',
      size: String(storedBytes.byteLength),
    }), { status: 200 });
  };
  const session = { accessToken: 'a'.repeat(40) };
  const receipt = await createRelayRecoveryClaim(
    session,
    metadataBytes,
    metadata,
    attemptedAt,
    fetchImplementation,
  );
  assert.equal(validateRelayRecoveryClaimReceipt(receipt, metadataBytes, metadata), receipt);
  assert.equal(requests[0].url.searchParams.get('ifGenerationMatch'), '0');
  assert.equal(requests[1].url.searchParams.get('generation'), '223456789');
  await observePinnedRelayRecoveryClaim(
    session,
    receipt,
    metadataBytes,
    metadata,
    fetchImplementation,
  );
  assert.equal(requests.at(-2).url.searchParams.get('generation'), '223456789');
  assert.equal(requests.at(-1).url.searchParams.get('generation'), '223456789');

  const inventory = recoveredInventory(receipt);
  assert.equal(validateRelayServicesRecoveredInventory(inventory, receipt), inventory);
  const result = buildRelayServicesRecoveryResult({
    metadata,
    claimReceipt: receipt,
    output: privateBootstrapOutput(inventory),
    inventory,
  });
  assert.equal(result.relays[0].memory, '512Mi');
  assert.equal(result.public_iam_members, 0);
  assert.equal(result.live_requests_by_driver, 0);
});

test('makes both recovery claims fail closed and non-retryable', async () => {
  const session = { accessToken: 'a'.repeat(40) };
  assert.deepEqual(
    await observeRelayRecoveryClaimAbsent(
      session,
      async () => new Response('', { status: 404 }),
    ),
    relayRecoveryClaimAbsence(),
  );
  await assert.rejects(
    observeRelayRecoveryClaimAbsent(
      session,
      async () => new Response('{}', { status: 200 }),
    ),
    /already exists/u,
  );
  const { metadata, metadataBytes } = validRecoveryMetadata();
  await assert.rejects(
    createRelayRecoveryClaim(
      session,
      metadataBytes,
      metadata,
      metadata.created_at,
      async () => { throw new Error('ambiguous transport'); },
    ),
    /outcome is unknown/u,
  );
  const profile = validateRelayServicesProfile();
  const requests = [];
  await assert.rejects(
    observePinnedOriginalRelayBootstrapClaim(session, async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.searchParams.get('alt') === 'media') {
        return new Response('drifted original claim', { status: 200 });
      }
      return new Response(JSON.stringify({
        bucket: profile.operation.claim_bucket,
        name: profile.operation.original_claim_object,
        generation: profile.operation.original_claim_generation,
        size: String(profile.operation.original_claim_size_bytes),
      }), { status: 200 });
    }),
    /content has drifted/u,
  );
  assert.equal(requests[0].searchParams.get('generation'), profile.operation.original_claim_generation);
  assert.equal(requests[1].searchParams.get('generation'), profile.operation.original_claim_generation);
});

test('retires bootstrap replay and keeps recovery claim-first, single-use and request-free', () => {
  const apply = readFileSync(new URL('../browser-relay-services/apply.mjs', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../browser-relay-services/plan.mjs', import.meta.url), 'utf8');
  const recoveryApply = readFileSync(
    new URL('../browser-relay-services/recovery-apply.mjs', import.meta.url),
    'utf8',
  );
  const recoveryClaim = readFileSync(
    new URL('../browser-relay-services/recovery-claim.mjs', import.meta.url),
    'utf8',
  );
  const recoveryPlan = readFileSync(
    new URL('../browser-relay-services/recovery-plan.mjs', import.meta.url),
    'utf8',
  );
  assert.match(apply, /export const RELAY_SERVICES_BOOTSTRAP_OPERATION_CONSUMED = true/u);
  assert.match(plan, /export const RELAY_SERVICES_BOOTSTRAP_OPERATION_CONSUMED = true/u);
  assert.ok(recoveryApply.indexOf('writeMutationAttemptMarker(bundle, freshMetadata)')
    < recoveryApply.indexOf('createRelayRecoveryClaim('));
  assert.ok(recoveryApply.indexOf('createRelayRecoveryClaim(')
    < recoveryApply.indexOf("'apply', '-input=false'"));
  assert.equal(recoveryApply.match(/'apply', '-input=false'/gu)?.length, 1);
  assert.match(recoveryApply, /'apply', '-input=false', '-lock-timeout=5m'/u);
  assert.doesNotMatch(recoveryApply, /fetch\(/u);
  assert.match(recoveryApply, /must never be retried/u);
  assert.match(recoveryApply, /Do not retry either saved plan/u);
  assert.match(recoveryClaim, /ifGenerationMatch', '0'/u);
  assert.doesNotMatch(recoveryClaim, /method:\s*'DELETE'/u);
  assert.match(recoveryPlan, /allowedStatuses:\s*\[2\]/u);
  assert.match(recoveryPlan, /baselineAfterPlan/u);
});

test('rejects consumed or hostile recovery execution before any cloud access', () => {
  for (const name of ['plan.mjs', 'apply.mjs']) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../browser-relay-services/${name}`, import.meta.url))],
      {
        encoding: 'utf8',
        env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '/private/tmp/forbidden' },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is consumed after its failed single attempt/u);
  }

  for (const [name, confirmation] of [
    ['recovery-plan.mjs', 'MIAKAPP_STAGING_RELAY_SERVICES_RECOVERY_PLAN_CONFIRMATION'],
    ['recovery-apply.mjs', 'MIAKAPP_STAGING_RELAY_SERVICES_RECOVERY_APPLY_AUTHORIZATION'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL(`../browser-relay-services/${name}`, import.meta.url)),
        '/private/tmp/not-read-before-environment-validation',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          [confirmation]: 'intentionally-invalid',
          GOOGLE_APPLICATION_CREDENTIALS: '/private/tmp/forbidden',
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Environment override GOOGLE_APPLICATION_CREDENTIALS is forbidden/u);
  }
});
