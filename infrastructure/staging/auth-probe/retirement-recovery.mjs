import { isDeepStrictEqual } from 'node:util';

import {
  CUSTOM_ROLE_NAME,
  PROBE_ACCOUNT,
  PROJECT_ID,
  REGION,
  TERRAFORM_VERSION,
  WORKFLOW_NAME,
  canonicalJson,
  sha256,
} from './contract.mjs';

export const AUTH_PROBE_STATE_ADDRESSES = Object.freeze([
  'data.terraform_remote_state.firebase_auth',
  'data.terraform_remote_state.workload',
  'google_project_iam_custom_role.auth_probe',
  'google_project_iam_member.auth_probe[0]',
  'google_service_account_iam_member.auth_probe_self_signer[0]',
  'google_workflows_workflow.auth_probe[0]',
  'terraform_data.auth_probe_guard',
]);
export const TEMPORARY_ADDRESS_BY_KIND = Object.freeze({
  project_role_binding: 'google_project_iam_member.auth_probe[0]',
  self_signer_binding: 'google_service_account_iam_member.auth_probe_self_signer[0]',
  workflow: 'google_workflows_workflow.auth_probe[0]',
});
const MAXIMUM_STATE_BYTES = 32 * 1024 * 1024;

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

function validateInstanceTarget(address, attributes) {
  if (!plainObject(attributes)) reject(`${address} state attributes are missing`);
  switch (address) {
    case 'google_project_iam_custom_role.auth_probe':
      exact(attributes.name, CUSTOM_ROLE_NAME, `${address}.name`);
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      break;
    case 'google_project_iam_member.auth_probe[0]':
      exact(attributes.project, PROJECT_ID, `${address}.project`);
      exact(attributes.role, CUSTOM_ROLE_NAME, `${address}.role`);
      exact(attributes.member, `serviceAccount:${PROBE_ACCOUNT}`, `${address}.member`);
      break;
    case 'google_service_account_iam_member.auth_probe_self_signer[0]':
      exact(
        attributes.service_account_id,
        `projects/${PROJECT_ID}/serviceAccounts/${PROBE_ACCOUNT}`,
        `${address}.service_account_id`,
      );
      exact(attributes.role, 'roles/iam.serviceAccountTokenCreator', `${address}.role`);
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
  let customRoleStatus = 'absent';
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
        'google_project_iam_member.auth_probe',
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
      validateInstanceTarget(address, instance.attributes);
      addresses.push(address);
      if (address === 'google_project_iam_custom_role.auth_probe') {
        customRoleStatus = instance.status === 'tainted' ? 'tainted' : 'managed';
      }
    }
  }
  return Object.freeze({
    serial: state.serial,
    lineage_sha256: sha256(Buffer.from(state.lineage, 'utf8')),
    sha256: sha256(raw),
    addresses: Object.freeze(addresses.sort()),
    custom_role_status: customRoleStatus,
  });
}

export function buildAuthProbeRetirementRecoveryInventory(state, live) {
  if (!plainObject(state) || !Array.isArray(state.addresses)
    || !plainObject(live) || live.project_id !== PROJECT_ID) {
    reject('Auth-probe retirement recovery inventory is invalid');
  }
  const missingTemporaries = Object.entries(TEMPORARY_ADDRESS_BY_KIND)
    .filter(([kind, address]) => {
      const present = kind === 'workflow' ? live.workflow !== null : live[kind] === true;
      return present && !state.addresses.includes(address);
    })
    .map(([kind]) => kind)
    .sort();
  const absentRemoteTemporaries = Object.entries(TEMPORARY_ADDRESS_BY_KIND)
    .filter(([kind, address]) => {
      const present = kind === 'workflow' ? live.workflow !== null : live[kind] === true;
      return !present && state.addresses.includes(address);
    })
    .map(([kind]) => kind)
    .sort();
  const customRoleStateAction = state.custom_role_status === 'absent'
    ? 'import'
    : state.custom_role_status === 'tainted' ? 'untaint' : null;
  const snapshot = Object.freeze({
    schema: 'miakapp.staging-auth-probe-retirement-recovery-inventory/1',
    project_id: PROJECT_ID,
    state_sha256: state.sha256,
    state_lineage_sha256: state.lineage_sha256,
    state_serial: state.serial,
    state_addresses: Object.freeze([...state.addresses]),
    live,
    missing_temporaries: Object.freeze(missingTemporaries),
    absent_remote_temporaries: Object.freeze(absentRemoteTemporaries),
    custom_role_state_action: customRoleStateAction,
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
    || inventory.state_sha256 !== metadata.state_sha256
    || inventory.state_lineage_sha256 !== metadata.state_lineage_sha256
    || inventory.state_serial !== metadata.state_serial
    || !isDeepStrictEqual(inventory.state_addresses, metadata.state_addresses)
    || !isDeepStrictEqual(inventory.missing_temporaries, metadata.missing_temporaries)
    || !isDeepStrictEqual(
      inventory.absent_remote_temporaries,
      metadata.absent_remote_temporaries,
    )
    || inventory.custom_role_state_action !== metadata.custom_role_state_action
    || workflowRevision !== metadata.workflow_revision) {
    reject('Auth-probe live or state inventory changed after recovery planning');
  }
  return inventory;
}
