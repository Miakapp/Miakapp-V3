import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual, types } from 'node:util';

export const TRUSTED_PROVIDER_PROCESS_PROFILE_PATH =
  'browser-relay-trusted-provider-process/profile.json';
export const TRUSTED_PROVIDER_PROCESS_PROFILE_SHA256 =
  '7612f032ba778c157a533dfedb26c50bd4b9f665b1b4effefded477beb746446';
export const TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA =
  'miakapp.staging-browser-relay-trusted-provider-process-ipc/1';
export const TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION = 1;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES = 33_554_432;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES = 262_144;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES = 512;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES = 8_388_608;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES = 256;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES = 255;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES = 131_072;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAMES_PER_DIRECTION = 4;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_DEPTH = 32;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_JSON_TOKENS = 16_384;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_STRING_BYTES = 65_536;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_QUEUED_WRITE_BYTES = 262_144;
export const TRUSTED_PROVIDER_PROCESS_DEFAULT_READY_TIMEOUT_MILLISECONDS = 10_000;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_READY_TIMEOUT_MILLISECONDS = 60_000;
export const TRUSTED_PROVIDER_PROCESS_DEFAULT_OPERATION_TIMEOUT_MILLISECONDS = 1_500_000;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_OPERATION_TIMEOUT_MILLISECONDS = 1_800_000;
export const TRUSTED_PROVIDER_PROCESS_DEFAULT_CANCELLATION_GRACE_MILLISECONDS = 250;
export const TRUSTED_PROVIDER_PROCESS_MAXIMUM_CANCELLATION_GRACE_MILLISECONDS = 5_000;

export const TRUSTED_PROVIDER_PROCESS_ERROR_CODES = Object.freeze([
  'aborted',
  'already_executed',
  'cleanup_failed',
  'closed',
  'invalid_configuration',
  'invalid_protocol',
  'operation_timeout',
  'owner_close_failed',
  'owner_contract_failed',
  'owner_execution_failed',
  'owner_import_failed',
  'owner_integrity_failed',
  'owner_result_invalid',
  'peer_closed',
  'peer_failed',
  'ready_timeout',
  'unsupported_platform',
]);

const ERROR_CODE_SET = new Set(TRUSTED_PROVIDER_PROCESS_ERROR_CODES);
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_ID = /^[A-Za-z0-9_-]{43}$/u;
const CONTROL_OR_SURROGATE = /[\p{Cc}\p{Cs}]/u;
const PROFILE_PATH = new URL('profile.json', import.meta.url);
const MAXIMUM_PROFILE_BYTES = 24 * 1024;
const INTRINSIC_IS_PROXY = types.isProxy;
let operationContractTask;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;

export class StagingBrowserRelayTrustedProviderProcessError extends Error {
  constructor(code = 'invalid_configuration') {
    const safeCode = ERROR_CODE_SET.has(code) ? code : 'invalid_configuration';
    super(`Trusted provider process failed (${safeCode})`);
    this.name = 'StagingBrowserRelayTrustedProviderProcessError';
    this.code = safeCode;
  }
}

export function rejectTrustedProviderProcess(code) {
  throw new StagingBrowserRelayTrustedProviderProcessError(code);
}

function plainObject(value) {
  try {
    if (value === null || Array.isArray(value) || typeof value !== 'object'
      || INTRINSIC_IS_PROXY(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value, keys, code = 'invalid_protocol') {
  if (!plainObject(value)) rejectTrustedProviderProcess(code);
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return rejectTrustedProviderProcess(code);
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual([...ownKeys].sort(), [...keys].sort())) {
    rejectTrustedProviderProcess(code);
  }
  const snapshot = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true) {
      rejectTrustedProviderProcess(code);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function boundedInteger(value, minimum, maximum, code = 'invalid_configuration') {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    rejectTrustedProviderProcess(code);
  }
  return value;
}

function safeString(value, minimumBytes, maximumBytes, code = 'invalid_protocol') {
  if (typeof value !== 'string' || CONTROL_OR_SURROGATE.test(value)) {
    rejectTrustedProviderProcess(code);
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < minimumBytes || bytes > maximumBytes) rejectTrustedProviderProcess(code);
  return value;
}

function exactEnvelope(value, type, keys) {
  const message = exactKeys(value, [
    'schema',
    'protocol_version',
    'type',
    ...keys,
  ]);
  if (message.schema !== TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA
    || message.protocol_version !== TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION
    || message.type !== type) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return message;
}

function requestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadOperationContract() {
  operationContractTask ??= import('../browser-relay-operation/contract.mjs');
  return operationContractTask;
}

export async function preloadTrustedProviderProcessResultContract() {
  await loadOperationContract();
}

export function validateTrustedProviderProcessOptions(value) {
  const options = exactKeys(value, [
    'owner_bundle_path',
    'owner_bundle_sha256',
    'ready_timeout_milliseconds',
    'operation_timeout_milliseconds',
    'cancellation_grace_milliseconds',
  ], 'invalid_configuration');
  const ownerBundlePath = safeString(
    options.owner_bundle_path,
    1,
    4_096,
    'invalid_configuration',
  );
  if (!isAbsolute(ownerBundlePath) || resolve(ownerBundlePath) !== ownerBundlePath) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  if (typeof options.owner_bundle_sha256 !== 'string'
    || !SHA256.test(options.owner_bundle_sha256)) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  return Object.freeze({
    owner_bundle_path: ownerBundlePath,
    owner_bundle_sha256: options.owner_bundle_sha256,
    ready_timeout_milliseconds: boundedInteger(
      options.ready_timeout_milliseconds,
      1,
      TRUSTED_PROVIDER_PROCESS_MAXIMUM_READY_TIMEOUT_MILLISECONDS,
    ),
    operation_timeout_milliseconds: boundedInteger(
      options.operation_timeout_milliseconds,
      1,
      TRUSTED_PROVIDER_PROCESS_MAXIMUM_OPERATION_TIMEOUT_MILLISECONDS,
    ),
    cancellation_grace_milliseconds: boundedInteger(
      options.cancellation_grace_milliseconds,
      1,
      TRUSTED_PROVIDER_PROCESS_MAXIMUM_CANCELLATION_GRACE_MILLISECONDS,
    ),
  });
}

export function buildTrustedProviderProcessOptions(value) {
  const options = exactKeys(value, [
    'owner_bundle_path',
    'owner_bundle_sha256',
  ], 'invalid_configuration');
  return validateTrustedProviderProcessOptions({
    ...options,
    ready_timeout_milliseconds:
      TRUSTED_PROVIDER_PROCESS_DEFAULT_READY_TIMEOUT_MILLISECONDS,
    operation_timeout_milliseconds:
      TRUSTED_PROVIDER_PROCESS_DEFAULT_OPERATION_TIMEOUT_MILLISECONDS,
    cancellation_grace_milliseconds:
      TRUSTED_PROVIDER_PROCESS_DEFAULT_CANCELLATION_GRACE_MILLISECONDS,
  });
}

export function normalizeTrustedProviderProcessOptions(value) {
  if (!plainObject(value)) rejectTrustedProviderProcess('invalid_configuration');
  let keys;
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) {
      rejectTrustedProviderProcess('invalid_configuration');
    }
    keys = ownKeys.sort();
  } catch {
    return rejectTrustedProviderProcess('invalid_configuration');
  }
  const minimal = ['owner_bundle_path', 'owner_bundle_sha256'];
  const complete = [
    'cancellation_grace_milliseconds',
    'operation_timeout_milliseconds',
    'owner_bundle_path',
    'owner_bundle_sha256',
    'ready_timeout_milliseconds',
  ];
  if (isDeepStrictEqual(keys, minimal)) return buildTrustedProviderProcessOptions(value);
  if (isDeepStrictEqual(keys, complete)) return validateTrustedProviderProcessOptions(value);
  return rejectTrustedProviderProcess('invalid_configuration');
}

export function validateTrustedProviderProcessExecuteInput(value = {}) {
  if (!plainObject(value)) rejectTrustedProviderProcess('invalid_configuration');
  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return rejectTrustedProviderProcess('invalid_configuration');
  }
  const fields = ownKeys.length === 0
    ? []
    : (ownKeys.length === 1 && ownKeys[0] === 'signal' ? ['signal'] : undefined);
  if (fields === undefined) rejectTrustedProviderProcess('invalid_configuration');
  const input = exactKeys(value, fields, 'invalid_configuration');
  if (input.signal !== undefined) {
    const signal = input.signal;
    let aborted;
    try {
      aborted = Reflect.apply(ABORTED_GETTER, signal, []);
    } catch {
      return rejectTrustedProviderProcess('invalid_configuration');
    }
    if (typeof aborted !== 'boolean') rejectTrustedProviderProcess('invalid_configuration');
  }
  return Object.freeze({ ...(input.signal === undefined ? {} : { signal: input.signal }) });
}

export function validateTrustedProviderOwnerModule(value) {
  let ownKeys;
  let descriptors;
  try {
    if (value === null || typeof value !== 'object' || INTRINSIC_IS_PROXY(value)) {
      rejectTrustedProviderProcess('owner_contract_failed');
    }
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return rejectTrustedProviderProcess('owner_contract_failed');
  }
  const moduleTag = descriptors[Symbol.toStringTag];
  const moduleTagPresent = ownKeys.includes(Symbol.toStringTag);
  if (!isDeepStrictEqual(
    ownKeys.filter((key) => typeof key === 'string'),
    ['createBrowserRelayTrustedProviderOwner'],
  )
    || ownKeys.some((key) => typeof key === 'symbol' && key !== Symbol.toStringTag)
    || (moduleTagPresent && (moduleTag?.value !== 'Module'
      || moduleTag.enumerable || moduleTag.configurable || moduleTag.writable))
    || (!moduleTagPresent && ownKeys.length !== 1)) {
    rejectTrustedProviderProcess('owner_contract_failed');
  }
  const factory = descriptors.createBrowserRelayTrustedProviderOwner;
  if (factory === undefined || !Object.hasOwn(factory, 'value')
    || !factory.enumerable || typeof factory.value !== 'function') {
    rejectTrustedProviderProcess('owner_contract_failed');
  }
  return factory.value;
}

export function validateTrustedProviderOwner(value) {
  const owner = exactKeys(value, ['close', 'execute'], 'owner_contract_failed');
  if (typeof owner.execute !== 'function' || typeof owner.close !== 'function') {
    rejectTrustedProviderProcess('owner_contract_failed');
  }
  return Object.freeze({
    execute: owner.execute.bind(value),
    close: owner.close.bind(value),
  });
}

export async function cloneValidatedTrustedProviderProcessResult(value) {
  let validateOperationResult;
  let serialized;
  try {
    ({ validateOperationResult } = await loadOperationContract());
    validateOperationResult(value);
    serialized = JSON.stringify(value);
  } catch {
    rejectTrustedProviderProcess('owner_result_invalid');
  }
  if (serialized === undefined
    || Buffer.byteLength(serialized, 'utf8') > TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES) {
    rejectTrustedProviderProcess('owner_result_invalid');
  }
  let clone;
  try {
    clone = JSON.parse(serialized);
    validateOperationResult(clone);
  } catch {
    rejectTrustedProviderProcess('owner_result_invalid');
  }
  return clone;
}

export function buildTrustedProviderProcessReady(ownerBundleSha256) {
  if (typeof ownerBundleSha256 !== 'string' || !SHA256.test(ownerBundleSha256)) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'ready',
    owner_bundle_sha256: ownerBundleSha256,
  });
}

export function validateTrustedProviderProcessReady(value, expectedSha256) {
  const message = exactEnvelope(value, 'ready', ['owner_bundle_sha256']);
  if (message.owner_bundle_sha256 !== expectedSha256 || !SHA256.test(expectedSha256)) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return message;
}

export function buildTrustedProviderProcessStartupFailure(code) {
  if (!ERROR_CODE_SET.has(code)) rejectTrustedProviderProcess('invalid_protocol');
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'startup_failure',
    code,
  });
}

export function validateTrustedProviderProcessStartupFailure(value) {
  const message = exactEnvelope(value, 'startup_failure', ['code']);
  if (!ERROR_CODE_SET.has(message.code)) rejectTrustedProviderProcess('invalid_protocol');
  return message.code;
}

export function buildTrustedProviderProcessExecute(requestIdentifier) {
  requestId(requestIdentifier);
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'execute',
    request_id: requestIdentifier,
  });
}

export function validateTrustedProviderProcessExecute(value) {
  const message = exactEnvelope(value, 'execute', ['request_id']);
  requestId(message.request_id);
  return message;
}

export function buildTrustedProviderProcessCancel(requestIdentifier) {
  requestId(requestIdentifier);
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'cancel',
    request_id: requestIdentifier,
  });
}

export function validateTrustedProviderProcessCancel(value, expectedRequestId) {
  const message = exactEnvelope(value, 'cancel', ['request_id']);
  if (requestId(message.request_id) !== expectedRequestId) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return message;
}

export async function buildTrustedProviderProcessResult(requestIdentifier, value) {
  requestId(requestIdentifier);
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'result',
    request_id: requestIdentifier,
    result: await cloneValidatedTrustedProviderProcessResult(value),
  });
}

export async function validateTrustedProviderProcessResult(value, expectedRequestId) {
  const message = exactEnvelope(value, 'result', ['request_id', 'result']);
  if (requestId(message.request_id) !== expectedRequestId) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return cloneValidatedTrustedProviderProcessResult(message.result);
}

export function buildTrustedProviderProcessFailure(requestIdentifier, code) {
  requestId(requestIdentifier);
  if (!ERROR_CODE_SET.has(code)) rejectTrustedProviderProcess('invalid_protocol');
  return Object.freeze({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
    type: 'failure',
    request_id: requestIdentifier,
    code,
  });
}

export function validateTrustedProviderProcessFailure(value, expectedRequestId) {
  const message = exactEnvelope(value, 'failure', ['request_id', 'code']);
  if (requestId(message.request_id) !== expectedRequestId || !ERROR_CODE_SET.has(message.code)) {
    rejectTrustedProviderProcess('invalid_protocol');
  }
  return message.code;
}

export function validateBrowserRelayTrustedProviderProcessProfile(
  path = PROFILE_PATH,
) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 2
    || entry.size > MAXIMUM_PROFILE_BYTES) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== TRUSTED_PROVIDER_PROCESS_PROFILE_SHA256) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  const root = exactKeys(profile, [
    'schema', 'revision', 'state', 'target', 'protocol', 'ownership', 'lifecycle',
    'compatibility', 'authority', 'evidence', 'pins',
  ], 'invalid_configuration');
  if (root.schema !== 'miakapp.staging-browser-relay-trusted-provider-process-profile/1'
    || root.revision !== 2
    || root.target?.project_id !== 'miakapp-v4-staging'
    || root.target?.data_policy !== 'synthetic_only'
    || root.target?.cloud_compute_resources !== 0
    || root.protocol?.version !== TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION
    || root.protocol?.maximum_frame_bytes !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES
    || root.protocol?.maximum_frames_per_direction
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAMES_PER_DIRECTION
    || root.ownership?.dedicated_process_ipc_present !== true
    || root.ownership?.owner_bundle_format !== 'canonical_manifest_payload_v1'
    || root.ownership?.owner_bundle_maximum_bytes
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES
    || root.ownership?.owner_bundle_manifest_maximum_bytes
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES
    || root.ownership?.owner_bundle_maximum_files
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES
    || root.ownership?.owner_bundle_file_maximum_bytes
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES
    || root.ownership?.owner_bundle_path_maximum_bytes
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES
    || root.ownership?.owner_bundle_segment_maximum_bytes
      !== TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES
    || root.ownership?.non_builtin_module_resolution_confined_to_workspace !== true
    || root.ownership?.package_scope_metadata_confined_to_workspace !== true
    || root.ownership?.node_builtin_module_resolution_allowed !== true
    || root.ownership?.verified_bytes_materialized_to_private_workspace !== true
    || root.ownership?.verified_entry_imported_by_file_url !== true
    || root.ownership?.parent_owned_workspace_cleanup !== true
    || root.ownership?.parent_crash_workspace_cleanup_guaranteed !== false
    || root.ownership?.operating_system_sandbox_present !== false
    || root.ownership?.same_user_filesystem_and_network_authority_retained !== true
    || root.lifecycle?.single_use_process_per_operation !== true
    || root.lifecycle?.cooperative_cancel_sent_at_most_once !== true
    || root.lifecycle?.parent_verifies_process_group_empty_before_settlement !== true
    || root.lifecycle?.automatic_restart_or_replay !== false
    || root.compatibility?.node_version_range !== '>=22.22.0 <23'
    || root.compatibility?.ci_node_version !== '22.22.0'
    || root.compatibility?.dependency_bearing_owner_bundle_proven !== true
    || root.compatibility?.relative_esm_dependency_proven !== true
    || root.compatibility?.esm_and_commonjs_resolution_boundary_proven !== true
    || root.compatibility?.playwright_core_package_tree_proven !== true
    || root.compatibility?.playwright_core_version !== '1.62.1'
    || root.compatibility?.playwright_browser_metadata_resolution_proven !== true
    || root.compatibility?.browser_binary_packaged !== false
    || root.compatibility?.browser_launch_proven !== false
    || root.compatibility?.live_owner_bundle_present !== false
    || root.compatibility?.live_operation_wired !== false
    || root.authority?.cloud_mutations_authorized !== false
    || root.authority?.credentials_accepted_by_parent !== false
    || root.evidence?.browser_launches !== 0
    || root.evidence?.network_requests !== 0
    || root.evidence?.live_execution_count !== 0
    || root.evidence?.external_module_resolution_regression_runs !== 1
    || root.evidence?.incremental_monthly_cost_eur !== 0) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  return Object.freeze(profile);
}
