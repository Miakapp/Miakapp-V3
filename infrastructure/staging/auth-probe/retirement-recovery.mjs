import { isDeepStrictEqual } from 'node:util';

import {
  CLOUD_ASSET_SERVICE,
  CUSTOM_ROLE_NAME,
  CUSTOM_ROLE_PERMISSIONS,
  FIRESTORE_ROLE_NAME,
  FIRESTORE_ROLE_PERMISSIONS,
  PROBE_ACCOUNT,
  PROJECT_ID,
  REGION,
  SIGNER_ROLE_NAME,
  SIGNER_ROLE_PERMISSIONS,
  TERRAFORM_VERSION,
  VERIFIER_ACCOUNT,
  VERIFIER_SERVICE_NAME,
  WORKFLOW_NAME,
  canonicalJson,
  sha256,
} from './contract.mjs';
import { classifyAuthProbeGuardValue } from './validate-plan.mjs';

export const AUTH_PROBE_STATE_ADDRESSES = Object.freeze([
  'data.terraform_remote_state.firebase_auth',
  'data.terraform_remote_state.workload',
  'google_cloud_run_v2_service.auth_probe_verifier[0]',
  'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
  'google_project_iam_custom_role.auth_probe',
  'google_project_iam_custom_role.auth_probe_firestore',
  'google_project_iam_custom_role.auth_probe_signer',
  'google_project_iam_member.auth_probe[0]',
  'google_project_iam_member.auth_probe_firestore[0]',
  'google_project_service.auth_probe_asset_inventory',
  'google_service_account.auth_probe_verifier',
  'google_service_account_iam_member.auth_probe_self_signer[0]',
  'google_workflows_workflow.auth_probe[0]',
  'terraform_data.auth_probe_guard',
]);
export const PERSISTENT_RESOURCE_IMPORTS = Object.freeze({
  'google_project_iam_custom_role.auth_probe': CUSTOM_ROLE_NAME,
  'google_project_iam_custom_role.auth_probe_firestore': FIRESTORE_ROLE_NAME,
  'google_project_iam_custom_role.auth_probe_signer': SIGNER_ROLE_NAME,
  'google_project_service.auth_probe_asset_inventory': `${PROJECT_ID}/${CLOUD_ASSET_SERVICE}`,
  'google_service_account.auth_probe_verifier': `projects/${PROJECT_ID}/serviceAccounts/${VERIFIER_ACCOUNT}`,
});
export const AUTH_PROBE_RETIRED_STATE_ADDRESSES = Object.freeze([
  'data.terraform_remote_state.firebase_auth',
  'data.terraform_remote_state.workload',
  ...Object.keys(PERSISTENT_RESOURCE_IMPORTS),
  'terraform_data.auth_probe_guard',
].sort());
export const TEMPORARY_ADDRESS_BY_KIND = Object.freeze({
  verifier_service: 'google_cloud_run_v2_service.auth_probe_verifier[0]',
  verifier_invoker_binding: 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]',
  project_role_binding: 'google_project_iam_member.auth_probe[0]',
  firestore_role_binding: 'google_project_iam_member.auth_probe_firestore[0]',
  self_signer_binding: 'google_service_account_iam_member.auth_probe_self_signer[0]',
  workflow: 'google_workflows_workflow.auth_probe[0]',
});
const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;
const TERRAFORM_DATA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const IAM_ETAG = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CLOUD_ASSET_ADDRESS = 'google_project_service.auth_probe_asset_inventory';
const VERIFIER_SERVICE_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/services/${VERIFIER_SERVICE_NAME}`;
const CUSTOM_ROLE_RECOVERY = Object.freeze({
  'google_project_iam_custom_role.auth_probe': Object.freeze({
    key: 'firebase',
    binding_key: 'project_role_binding',
    resource: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
    asset_type: 'cloudresourcemanager.googleapis.com/Project',
    name: CUSTOM_ROLE_NAME,
    permissions: CUSTOM_ROLE_PERMISSIONS,
  }),
  'google_project_iam_custom_role.auth_probe_firestore': Object.freeze({
    key: 'firestore',
    binding_key: 'firestore_role_binding',
    resource: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
    asset_type: 'cloudresourcemanager.googleapis.com/Project',
    name: FIRESTORE_ROLE_NAME,
    permissions: FIRESTORE_ROLE_PERMISSIONS,
  }),
  'google_project_iam_custom_role.auth_probe_signer': Object.freeze({
    key: 'signer',
    binding_key: 'self_signer_binding',
    resource: `//iam.googleapis.com/projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
    asset_type: 'iam.googleapis.com/ServiceAccount',
    name: SIGNER_ROLE_NAME,
    permissions: SIGNER_ROLE_PERMISSIONS,
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

function baseAddress(resource) {
  return resource.mode === 'data'
    ? `data.${resource.type}.${resource.name}`
    : `${resource.type}.${resource.name}`;
}

function terraformDynamicType(value) {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (Array.isArray(value)) return ['tuple', value.map(terraformDynamicType)];
  if (plainObject(value)) {
    return ['object', Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, terraformDynamicType(entry)]),
    )];
  }
  reject('Terraform dynamic value contains an unsupported type');
}

function unwrapTerraformDynamicValue(wrapper, description) {
  if (!plainObject(wrapper)) reject(`${description} wrapper is missing`);
  exact(Object.keys(wrapper).sort(), ['type', 'value'], `${description} wrapper fields`);
  exact(wrapper.type, terraformDynamicType(wrapper.value), `${description} type`);
  return wrapper.value;
}

function validateInstanceTarget(address, attributes) {
  if (!plainObject(attributes)) reject(`${address} state attributes are missing`);
  switch (address) {
    case 'google_project_iam_custom_role.auth_probe':
      exact(attributes.name, CUSTOM_ROLE_NAME, `${address}.name`);
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_project_iam_custom_role.auth_probe_firestore':
      exact(attributes.name, FIRESTORE_ROLE_NAME, `${address}.name`);
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_project_iam_custom_role.auth_probe_signer':
      exact(attributes.name, SIGNER_ROLE_NAME, `${address}.name`);
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_project_iam_member.auth_probe[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.role, CUSTOM_ROLE_NAME, `${address}.role`);
      exact(attributes.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_project_iam_member.auth_probe_firestore[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.role, FIRESTORE_ROLE_NAME, `${address}.role`);
      exact(attributes.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_service_account_iam_member.auth_probe_self_signer[0]':
      exact(
        attributes.service_account_id,
        `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        `${address}.service_account_id`,
      );
      exact(attributes.role, SIGNER_ROLE_NAME, `${address}.role`);
      exact(attributes.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_service_account.auth_probe_verifier':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.email, VERIFIER_ACCOUNT, `${address}.email`);
      break;
    case 'google_project_service.auth_probe_asset_inventory':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.service, CLOUD_ASSET_SERVICE, `${address}.service`);
      break;
    case 'terraform_data.auth_probe_guard':
      exact(
        Object.keys(attributes).sort(),
        ['id', 'input', 'output', 'triggers_replace'],
        `${address} state fields`,
      );
      if (typeof attributes.id !== 'string' || !TERRAFORM_DATA_ID.test(attributes.id)) {
        reject(`${address}.id is invalid`);
      }
      exact(attributes.triggers_replace, null, `${address}.triggers_replace`);
      const input = unwrapTerraformDynamicValue(attributes.input, `${address}.input`);
      const output = unwrapTerraformDynamicValue(attributes.output, `${address}.output`);
      exact(output, input, `${address} input/output value`);
      exact(attributes.output.type, attributes.input.type, `${address} input/output type`);
      return classifyAuthProbeGuardValue({ input });
    case 'google_cloud_run_v2_service.auth_probe_verifier[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.location, REGION, `${address}.location`);
      exact(attributes.name, VERIFIER_SERVICE_NAME, `${address}.name`);
      break;
    case 'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.location, REGION, `${address}.location`);
      if (![VERIFIER_SERVICE_NAME, VERIFIER_SERVICE_RESOURCE].includes(attributes.name)) {
        reject(`${address}.name does not match the reviewed value`);
      }
      exact(attributes.role, 'roles/run.servicesInvoker', `${address}.role`);
      exact(attributes.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_workflows_workflow.auth_probe[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.region, REGION, `${address}.region`);
      exact(attributes.name, WORKFLOW_NAME, `${address}.name`);
      break;
    default:
      break;
  }
  return null;
}

export function inspectAuthProbeState(bytes) {
  const raw = Buffer.from(bytes ?? '');
  if (raw.byteLength === 0 || raw.byteLength > MAXIMUM_STATE_BYTES) {
    reject('Auth-probe Terraform state size is invalid');
  }
  let state;
  try {
    state = JSON.parse(raw.toString('utf8'));
  } catch {
    return reject('Auth-probe Terraform state is invalid JSON');
  }
  if (!plainObject(state) || state.version !== 4
    || state.terraform_version !== TERRAFORM_VERSION
    || !Number.isSafeInteger(state.serial) || state.serial < 0
    || typeof state.lineage !== 'string' || !/^[0-9a-f-]{36}$/u.test(state.lineage)
    || !plainObject(state.outputs) || !Array.isArray(state.resources)
    || Object.keys(state.outputs).some((name) => name !== 'staging_auth_probe')) {
    reject('Auth-probe Terraform state header is invalid');
  }
  const addresses = [];
  const persistentResourceStatuses = Object.fromEntries(
    Object.keys(PERSISTENT_RESOURCE_IMPORTS).map((address) => [address, 'absent']),
  );
  let guardStateStatus = 'absent';
  for (const resource of state.resources) {
    if (!plainObject(resource) || resource.module !== undefined || !Array.isArray(resource.instances)) {
      reject('Auth-probe Terraform state contains a malformed or nested resource');
    }
    const base = baseAddress(resource);
    for (const instance of resource.instances) {
      if (!plainObject(instance) || instance.deposed !== undefined
        || (instance.status !== undefined && instance.status !== 'tainted')) {
        reject('Auth-probe Terraform state contains an unsupported instance');
      }
      const counted = [
        'google_cloud_run_v2_service.auth_probe_verifier',
        'google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker',
        'google_project_iam_member.auth_probe',
        'google_project_iam_member.auth_probe_firestore',
        'google_service_account_iam_member.auth_probe_self_signer',
        'google_workflows_workflow.auth_probe',
      ].includes(base);
      if ((counted && instance.index_key !== 0) || (!counted && instance.index_key !== undefined)) {
        reject('Auth-probe Terraform state contains an unexpected instance key');
      }
      const address = counted ? `${base}[0]` : base;
      if (!AUTH_PROBE_STATE_ADDRESSES.includes(address) || addresses.includes(address)) {
        reject('Auth-probe Terraform state contains an unreviewed or duplicate address');
      }
      const configuration = validateInstanceTarget(address, instance.attributes);
      addresses.push(address);
      if (PERSISTENT_RESOURCE_IMPORTS[address] !== undefined) {
        persistentResourceStatuses[address] = instance.status === 'tainted' ? 'tainted' : 'managed';
      }
      if (address === 'terraform_data.auth_probe_guard') {
        guardStateStatus = instance.status === 'tainted'
          ? `tainted_${configuration}`
          : configuration;
      }
    }
  }
  return Object.freeze({
    serial: state.serial,
    lineage_sha256: sha256(Buffer.from(state.lineage, 'utf8')),
    sha256: sha256(raw),
    addresses: Object.freeze(addresses.sort()),
    persistent_resource_statuses: Object.freeze(persistentResourceStatuses),
    guard_state_status: guardStateStatus,
  });
}

export function buildAuthProbeRetirementRecoveryInventory(state, live) {
  if (!plainObject(state) || !Array.isArray(state.addresses)
    || !plainObject(state.persistent_resource_statuses)
    || !['absent', 'current', 'previous', 'tainted_current', 'tainted_previous']
      .includes(state.guard_state_status)
    || !plainObject(live) || live.project_id !== PROJECT_ID
    || typeof live.cloud_asset_api !== 'boolean'
    || !plainObject(live.custom_roles)
    || !isDeepStrictEqual(Object.keys(live.custom_roles).sort(), ['firebase', 'firestore', 'signer'])
    || (live.cloud_asset_api
      ? !plainObject(live.custom_role_bindings)
      : live.custom_role_bindings !== null)
    || !plainObject(live.persistent_resources)
    || !isDeepStrictEqual(
      Object.keys(live.persistent_resources).sort(),
      Object.keys(PERSISTENT_RESOURCE_IMPORTS).sort(),
    )
    || Object.values(live.persistent_resources).some((present) => typeof present !== 'boolean')
    || [
      'firestore_role_binding',
      'project_role_binding',
      'self_signer_binding',
      'verifier_invoker_binding',
    ].some((kind) => typeof live[kind] !== 'boolean')
    || ['verifier_service', 'workflow'].some((kind) => (
      live[kind] !== null && !plainObject(live[kind])
    ))) {
    reject('Auth-probe retirement recovery inventory is invalid');
  }
  exact(
    live.persistent_resources[CLOUD_ASSET_ADDRESS],
    live.cloud_asset_api,
    'Cloud Asset API persistent inventory',
  );
  for (const [address, expected] of Object.entries(CUSTOM_ROLE_RECOVERY)) {
    const role = live.custom_roles[expected.key];
    if (role === null) {
      exact(live.persistent_resources[address], false, `${address} absence`);
      continue;
    }
    if (!plainObject(role)
      || role.name !== expected.name
      || !['GA', 'DISABLED'].includes(role.stage)
      || typeof role.deleted !== 'boolean'
      || typeof role.etag !== 'string' || role.etag.length === 0 || !IAM_ETAG.test(role.etag)
      || !isDeepStrictEqual(role.permissions, expected.permissions)) {
      reject(`${address} live custom-role inventory is invalid`);
    }
    exact(live.persistent_resources[address], !role.deleted, `${address} lifecycle`);
    if (role.deleted) {
      reject(`${address} is soft-deleted and requires manual recovery; automatic undelete is forbidden`);
    }
  }
  if (live.cloud_asset_api) {
    exact(
      Object.keys(live.custom_role_bindings).sort(),
      Object.keys(CUSTOM_ROLE_RECOVERY).sort(),
      'Custom-role binding inventory addresses',
    );
    for (const [address, expected] of Object.entries(CUSTOM_ROLE_RECOVERY)) {
      const bindingPresent = live[expected.binding_key] === true;
      const supplemental = live.custom_role_bindings[address];
      if (!plainObject(supplemental)
        || supplemental.role_name !== expected.name
        || supplemental.direct_binding_present !== bindingPresent
        || typeof supplemental.indexed_binding_present !== 'boolean'
        || supplemental.authoritative !== false) {
        reject(`${address} supplemental binding inventory is invalid`);
      }
      exact(
        supplemental.resource,
        supplemental.indexed_binding_present ? expected.resource : null,
        `${address} supplemental binding resource`,
      );
      exact(
        supplemental.asset_type,
        supplemental.indexed_binding_present ? expected.asset_type : null,
        `${address} supplemental binding asset type`,
      );
    }
  }
  const liveTemporaryPresent = (kind) => {
    if (kind === 'workflow' || kind === 'verifier_service') return live[kind] !== null;
    return live[kind] === true;
  };
  let missingTemporaries = Object.entries(TEMPORARY_ADDRESS_BY_KIND)
    .filter(([kind, address]) => {
      return liveTemporaryPresent(kind) && !state.addresses.includes(address);
    })
    .map(([kind]) => kind)
    .sort();
  let absentRemoteTemporaries = Object.entries(TEMPORARY_ADDRESS_BY_KIND)
    .filter(([kind, address]) => {
      return !liveTemporaryPresent(kind) && state.addresses.includes(address);
    })
    .map(([kind]) => kind)
    .sort();
  let persistentStateActions = Object.entries(PERSISTENT_RESOURCE_IMPORTS)
    .flatMap(([address, importId]) => {
      const livePresent = live.persistent_resources[address];
      const stateStatus = state.persistent_resource_statuses[address];
      if (live.cloud_asset_api && CUSTOM_ROLE_RECOVERY[address] !== undefined
        && !livePresent && stateStatus !== 'absent') {
        reject(`${address} is missing but its role ID is not verifiably reusable`);
      }
      if (livePresent && stateStatus === 'managed') return [];
      let action;
      if (livePresent) action = stateStatus === 'absent' ? 'import' : 'untaint';
      else action = stateStatus === 'absent' ? 'create' : 'recreate';
      return [Object.freeze({ address, action, import_id: importId })];
    })
    .sort((left, right) => left.address.localeCompare(right.address));
  const guardActionByStatus = Object.freeze({
    absent: 'create',
    current: null,
    previous: 'update',
    tainted_current: 'untaint',
    tainted_previous: 'untaint_then_update',
  });
  let guardStateAction = guardActionByStatus[state.guard_state_status] === null
    ? null
    : Object.freeze({
      address: 'terraform_data.auth_probe_guard',
      action: guardActionByStatus[state.guard_state_status],
    });
  let recoveryPhase = 'full';
  if (!live.cloud_asset_api) {
    recoveryPhase = 'cloud_asset_api_prerequisite';
    const stateStatus = state.persistent_resource_statuses[CLOUD_ASSET_ADDRESS];
    persistentStateActions = [Object.freeze({
      address: CLOUD_ASSET_ADDRESS,
      action: stateStatus === 'absent' ? 'enable_import' : 'enable_reimport',
      import_id: PERSISTENT_RESOURCE_IMPORTS[CLOUD_ASSET_ADDRESS],
    })];
    missingTemporaries = [];
    absentRemoteTemporaries = [];
    guardStateAction = null;
  }
  const retirementFinalizationRequired = recoveryPhase === 'full'
    && Object.entries(TEMPORARY_ADDRESS_BY_KIND).every(([kind, address]) => (
      !liveTemporaryPresent(kind) && !state.addresses.includes(address)
    ))
    && Object.keys(PERSISTENT_RESOURCE_IMPORTS).every((address) => (
      live.persistent_resources[address] === true
        && state.persistent_resource_statuses[address] === 'managed'
    ))
    && state.guard_state_status === 'current';
  const snapshot = Object.freeze({
    schema: 'miakapp.staging-auth-probe-retirement-recovery-inventory/1',
    recovery_phase: recoveryPhase,
    project_id: PROJECT_ID,
    state_sha256: state.sha256,
    state_lineage_sha256: state.lineage_sha256,
    state_serial: state.serial,
    state_addresses: Object.freeze([...state.addresses]),
    live,
    missing_temporaries: Object.freeze(missingTemporaries),
    absent_remote_temporaries: Object.freeze(absentRemoteTemporaries),
    persistent_state_actions: Object.freeze(persistentStateActions),
    deleted_custom_roles: Object.freeze([]),
    guard_state_status: state.guard_state_status,
    guard_state_action: guardStateAction,
    retirement_finalization_required: retirementFinalizationRequired,
  });
  return Object.freeze({
    ...snapshot,
    sha256: sha256(Buffer.from(canonicalJson(snapshot), 'utf8')),
  });
}

export function validateAuthProbeRetirementRecoveryInventory(inventory, metadata) {
  const workflowRevision = inventory?.live?.workflow?.revision ?? 'absent';
  if (!plainObject(inventory) || !plainObject(metadata)
    || inventory.sha256 !== metadata.inventory_sha256
    || inventory.recovery_phase !== metadata.recovery_phase
    || inventory.state_sha256 !== metadata.state_sha256
    || inventory.state_lineage_sha256 !== metadata.state_lineage_sha256
    || inventory.state_serial !== metadata.state_serial
    || !isDeepStrictEqual(inventory.state_addresses, metadata.state_addresses)
    || !isDeepStrictEqual(inventory.missing_temporaries, metadata.missing_temporaries)
    || !isDeepStrictEqual(
      inventory.absent_remote_temporaries,
      metadata.absent_remote_temporaries,
    )
    || !isDeepStrictEqual(inventory.persistent_state_actions, metadata.persistent_state_actions)
    || !isDeepStrictEqual(inventory.deleted_custom_roles, metadata.deleted_custom_roles)
    || inventory.guard_state_status !== metadata.guard_state_status
    || !isDeepStrictEqual(inventory.guard_state_action, metadata.guard_state_action)
    || inventory.retirement_finalization_required
      !== metadata.retirement_finalization_required
    || workflowRevision !== metadata.workflow_revision) {
    reject('Auth-probe live or state inventory changed after recovery planning');
  }
  return inventory;
}

export function requiresAuthProbeRetirementRecovery(inventory) {
  if (!plainObject(inventory)
    || !Array.isArray(inventory.missing_temporaries)
    || !Array.isArray(inventory.absent_remote_temporaries)
    || !Array.isArray(inventory.persistent_state_actions)
    || typeof inventory.retirement_finalization_required !== 'boolean'
    || (inventory.guard_state_action !== null && !plainObject(inventory.guard_state_action))) {
    reject('Auth-probe retirement recovery decision inventory is invalid');
  }
  return inventory.missing_temporaries.length !== 0
    || inventory.absent_remote_temporaries.length !== 0
    || inventory.persistent_state_actions.length !== 0
    || inventory.guard_state_action !== null
    || inventory.retirement_finalization_required;
}
