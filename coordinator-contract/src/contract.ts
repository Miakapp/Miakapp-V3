import {
  type JsonValue,
  validateJsonValue,
} from '@miakapp/synthetic-home-conformance';
import type { CoordinatorStatus } from './api.js';

export const CONTRACT_CORPUS_SCHEMA = 'miakapp.coordinator-contract/1' as const;

export const CONTRACT_LIMITS = Object.freeze({
  corpusBytes: 1_048_576,
  corpusValues: 50_000,
  corpusStringBytes: 1_048_576,
  observationValues: 50_000,
  observationStringBytes: 1_048_576,
  scenarios: 64,
  stimuli: 64,
  traceEntries: 256,
  stringBytes: 512,
});

const UTF8 = new TextEncoder();
const CONTROL_CHARACTER = /\p{Cc}/u;
const CONTRACT_ID = /^sdk_[a-z][a-z0-9_]{0,62}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,62}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const CONTRACT_COVERAGE = Object.freeze([
  'inert_construction',
  'startup_barrier',
  'atomic_declaration_activation',
  'declaration_reconciliation',
  'live_declaration_replacement',
  'declaration_failure_rollback',
  'lifecycle_ownership',
  'offline_rejection',
  'event_error_correlation',
  'outcome_unknown',
  'call_streaming',
  'call_cancellation',
  'presence_cleanup',
  'shadow_state',
  'recorded_effects',
  'unclassified_effect',
] as const);

export type ContractCoverage = (typeof CONTRACT_COVERAGE)[number];

export const DECLARATION_ORDER = Object.freeze([
  'state',
  'state_access',
  'events',
  'event_access',
  'functions',
] as const);

export type DeclarationDomain = (typeof DECLARATION_ORDER)[number];
export type DeclarationRevisions = Record<DeclarationDomain, number>;
export type ContractMode = 'sdk' | 'observe' | 'shadow_state' | 'recorded_action';
export type TokenReason = 'initial' | 'reauth' | 'reconnect';
export type OperationKind = 'state_set' | 'event' | 'call';
export type OperationOutcome =
  | 'not_dispatched'
  | 'sent'
  | 'applied'
  | 'succeeded'
  | 'failed'
  | 'outcome_unknown';
export type EffectKind = 'device_command' | 'notification_intent' | 'unclassified';
export type EffectDestination = 'recorder' | 'live' | 'rejected';

const INITIAL_DECLARATION_REVISIONS: DeclarationRevisions = Object.freeze({
  state: 0,
  state_access: 0,
  events: 0,
  event_access: 0,
  functions: 0,
});

export interface ContractSetup {
  mode: ContractMode;
  desired_declarations: DeclarationDomain[];
}

export type ContractStimulus =
  | { kind: 'construct' }
  | { kind: 'start'; promise_id: string }
  | { kind: 'welcome'; session_id: number; generation: number }
  | {
    kind: 'declaration_update';
    transaction: number;
    promise_ids: string[];
    changed_domains: DeclarationDomain[];
    revisions: DeclarationRevisions;
  }
  | { kind: 'declaration_handoff'; transaction: number }
  | { kind: 'declaration_ack'; domain: DeclarationDomain; transaction: number }
  | {
    kind: 'declaration_error';
    domain: DeclarationDomain;
    transaction: number;
    code: string;
  }
  | { kind: 'declaration_probe' }
  | { kind: 'disconnect'; phase: 'before_send' | 'sent' | 'accepted' | 'ready' }
  | {
    kind: 'operation';
    operation_id: string;
    operation: OperationKind;
    phase: 'before_send' | 'sent' | 'accepted';
    idempotency_key?: string | null;
  }
  | { kind: 'call_progress'; operation_id: string; value: JsonValue }
  | { kind: 'call_result'; operation_id: string; value: JsonValue }
  | { kind: 'call_cancel'; operation_id: string }
  | {
    kind: 'operation_terminal';
    operation_id: string;
    outcome: 'not_dispatched' | 'applied' | 'failed' | 'outcome_unknown';
  }
  | { kind: 'operation_error'; operation_id: string; code: string }
  | { kind: 'presence'; entries: PresenceTrace[] }
  | { kind: 'state_publish'; paths: string[] }
  | { kind: 'effect'; effect: EffectKind }
  | { kind: 'stop'; promise_id: string };

export interface LifecyclePromiseTrace {
  operation: 'start' | 'stop';
  promise_id: string;
  invocation_stimulus_index: number;
  settlement_stimulus_index: number;
  outcome: 'resolved' | 'rejected';
  code?: string;
  session_id?: number;
  generation?: number;
}

export interface DeclarationTrace {
  domain: DeclarationDomain;
  generation: number;
  transaction: number;
}

export interface DeclarationSnapshotTrace {
  generation: number;
  transaction: number;
  stimulus_index: number;
  revisions: DeclarationRevisions;
}

export interface DeclarationPromiseTrace {
  promise_id: string;
  transaction: number;
  stimulus_index: number;
  outcome: 'activated' | 'rejected';
  code?: string;
}

export interface OperationTrace {
  operation_id: string;
  operation: OperationKind;
  attempts: number;
  outcome: OperationOutcome;
  idempotency_key?: string | null;
}

export interface CallStreamTrace {
  operation_id: string;
  acceptance: 'resolved' | 'rejected';
  progress: JsonValue[];
  terminal:
    | { kind: 'result'; value: JsonValue }
    | { kind: 'error'; code: 'not_dispatched' | 'failed' | 'outcome_unknown' };
}

export interface PresenceTrace {
  session_id: number;
  user_id: string;
}

export interface EffectTrace {
  effect: EffectKind;
  destination: EffectDestination;
}

export interface ErrorTrace {
  code: string;
  stimulus_index: number;
  correlation?: {
    kind: 'event' | 'call';
    local_id: string;
  };
}

export interface ResourceTrace {
  sockets: number;
  socket_high_water: number;
  timers: number | 'not_asserted';
  listeners: number | 'not_asserted';
  iterators: number | 'not_asserted';
}

export interface StatusCheckpointTrace {
  stimulus_index: number;
  status: CoordinatorStatus;
}

export interface ContractObservation {
  statuses: CoordinatorStatus[];
  status_checkpoints: StatusCheckpointTrace[];
  lifecycle_promises: LifecyclePromiseTrace[];
  access_reasons: TokenReason[];
  declarations: DeclarationTrace[];
  declaration_snapshots: DeclarationSnapshotTrace[];
  declaration_promises: DeclarationPromiseTrace[];
  declaration_visibility: Array<'none' | 'previous' | 'desired'>;
  operations: OperationTrace[];
  call_streams: CallStreamTrace[];
  presence: PresenceTrace[][];
  state_publications: number;
  effects: EffectTrace[];
  errors: ErrorTrace[];
  resources: ResourceTrace;
}

export interface CoordinatorContractScenario {
  id: string;
  description: string;
  coverage: ContractCoverage[];
  setup: ContractSetup;
  stimuli: ContractStimulus[];
  expected: ContractObservation;
}

export interface CoordinatorContractCorpus {
  schema: typeof CONTRACT_CORPUS_SCHEMA;
  fixture_version: 1;
  required_coverage: ContractCoverage[];
  scenarios: CoordinatorContractScenario[];
}

export class ContractViolation extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContractViolation';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ContractViolation(code, message);
}

function assertAggregateBudget(
  value: unknown,
  label: string,
  maximumValues: number,
  maximumStringBytes: number,
): void {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let values = 0;
  let stringBytes = 0;

  const addStringBytes = (entry: string): void => {
    const remaining = maximumStringBytes - stringBytes;
    if (entry.length > remaining) {
      fail('limit_exceeded', `${label} exceeds its aggregate string budget`);
    }
    stringBytes += UTF8.encode(entry).byteLength;
    if (stringBytes > maximumStringBytes) {
      fail('limit_exceeded', `${label} exceeds its aggregate string budget`);
    }
  };

  while (stack.length > 0) {
    const current = stack.pop();
    values += 1;
    if (values > maximumValues) {
      fail('limit_exceeded', `${label} has too many aggregate values`);
    }
    if (typeof current === 'string') {
      addStringBytes(current);
    } else if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        fail('invalid_value', `${label} contains a cycle or repeated reference`);
      }
      seen.add(current);
      if (Array.isArray(current)) {
        for (const entry of current) stack.push(entry);
      } else if (isPlainRecord(current)) {
        for (const [key, entry] of Object.entries(current)) {
          addStringBytes(key);
          stack.push(entry);
        }
      }
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'object',
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('invalid_type', `${label} must be a plain record`);
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) fail('forbidden_key', `${label} contains forbidden key ${key}`);
    if (!allowed.has(key)) fail('unknown_field', `${label}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('missing_field', `${label}.${key} is required`);
  }
  return value;
}

function denseArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) fail('invalid_type', `${label} must be an array`);
  if (value.length > maximum) fail('limit_exceeded', `${label} has too many entries`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('invalid_type', `${label} must be dense`);
  }
  if (Object.keys(value).length !== value.length) fail('invalid_type', `${label} must be dense`);
  return value;
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_string', `${label} must be a non-empty string`);
  }
  if (CONTROL_CHARACTER.test(value)) fail('invalid_string', `${label} contains a control character`);
  if (UTF8.encode(value).byteLength > CONTRACT_LIMITS.stringBytes) {
    fail('limit_exceeded', `${label} is too large`);
  }
  return value;
}

function enumValue<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('invalid_value', `${label} is not allowed`);
  }
  return value as T;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('invalid_number', `${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonNegativeInteger(value, label);
  if (result === 0) fail('invalid_number', `${label} must be positive`);
  return result;
}

function resourceCount(value: unknown, label: string): number | 'not_asserted' {
  return value === 'not_asserted' ? value : nonNegativeInteger(value, label);
}

function contractId(value: unknown, label: string): string {
  const result = boundedString(value, label);
  if (!CONTRACT_ID.test(result)) fail('invalid_identifier', `${label} must use the sdk_ namespace`);
  return result;
}

function errorCode(value: unknown, label: string): string {
  const result = boundedString(value, label);
  if (!ERROR_CODE.test(result)) fail('invalid_identifier', `${label} is not an error code`);
  return result;
}

function declarationRevisions(value: unknown, label: string): DeclarationRevisions {
  const record = exactObject(value, DECLARATION_ORDER, [], label);
  return {
    state: nonNegativeInteger(record.state, `${label}.state`),
    state_access: nonNegativeInteger(record.state_access, `${label}.state_access`),
    events: nonNegativeInteger(record.events, `${label}.events`),
    event_access: nonNegativeInteger(record.event_access, `${label}.event_access`),
    functions: nonNegativeInteger(record.functions, `${label}.functions`),
  };
}

function revisionsEqual(left: DeclarationRevisions, right: DeclarationRevisions): boolean {
  return DECLARATION_ORDER.every((domain) => left[domain] === right[domain]);
}

function cloneRevisions(value: DeclarationRevisions): DeclarationRevisions {
  return { ...value };
}

function uniqueStrings<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T[] {
  const entries = denseArray(value, CONTRACT_LIMITS.traceEntries, label)
    .map((entry, index) => enumValue(entry, allowed, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) fail('duplicate', `${label} contains duplicates`);
  return entries;
}

function validatePresence(value: unknown, label: string): PresenceTrace {
  const record = exactObject(value, ['session_id', 'user_id'], [], label);
  return {
    session_id: positiveInteger(record.session_id, `${label}.session_id`),
    user_id: contractId(record.user_id, `${label}.user_id`),
  };
}

function validateStimulus(value: unknown, label: string): ContractStimulus {
  const root = exactObject(value, ['kind'], [
    'session_id',
    'generation',
    'transaction',
    'promise_ids',
    'promise_id',
    'changed_domains',
    'revisions',
    'domain',
    'phase',
    'operation_id',
    'operation',
    'idempotency_key',
    'value',
    'entries',
    'paths',
    'effect',
    'code',
    'outcome',
  ], label);
  const kind = enumValue(root.kind, [
    'construct',
    'start',
    'welcome',
    'declaration_update',
    'declaration_handoff',
    'declaration_ack',
    'declaration_error',
    'declaration_probe',
    'disconnect',
    'operation',
    'call_progress',
    'call_result',
    'call_cancel',
    'operation_terminal',
    'operation_error',
    'presence',
    'state_publish',
    'effect',
    'stop',
  ] as const, `${label}.kind`);

  if (kind === 'construct' || kind === 'declaration_probe') {
    exactObject(value, ['kind'], [], label);
    return { kind };
  }
  if (kind === 'start' || kind === 'stop') {
    exactObject(value, ['kind', 'promise_id'], [], label);
    return { kind, promise_id: contractId(root.promise_id, `${label}.promise_id`) };
  }
  if (kind === 'welcome') {
    exactObject(value, ['kind', 'session_id', 'generation'], [], label);
    return {
      kind,
      session_id: positiveInteger(root.session_id, `${label}.session_id`),
      generation: positiveInteger(root.generation, `${label}.generation`),
    };
  }
  if (kind === 'declaration_update') {
    exactObject(
      value,
      ['kind', 'transaction', 'promise_ids', 'changed_domains', 'revisions'],
      [],
      label,
    );
    const promiseIds = denseArray(
      root.promise_ids,
      CONTRACT_LIMITS.traceEntries,
      `${label}.promise_ids`,
    ).map((entry, index) => contractId(entry, `${label}.promise_ids[${index}]`));
    if (promiseIds.length === 0 || new Set(promiseIds).size !== promiseIds.length) {
      fail('duplicate', `${label}.promise_ids must be non-empty and unique`);
    }
    const changedDomains = uniqueStrings(
      root.changed_domains,
      DECLARATION_ORDER,
      `${label}.changed_domains`,
    );
    if (changedDomains.length === 0) {
      fail('missing_field', `${label}.changed_domains must contain at least one slice`);
    }
    return {
      kind,
      transaction: positiveInteger(root.transaction, `${label}.transaction`),
      promise_ids: promiseIds,
      changed_domains: changedDomains,
      revisions: declarationRevisions(root.revisions, `${label}.revisions`),
    };
  }
  if (kind === 'declaration_handoff') {
    exactObject(value, ['kind', 'transaction'], [], label);
    return {
      kind,
      transaction: positiveInteger(root.transaction, `${label}.transaction`),
    };
  }
  if (kind === 'declaration_ack') {
    exactObject(value, ['kind', 'domain', 'transaction'], [], label);
    return {
      kind,
      domain: enumValue(root.domain, DECLARATION_ORDER, `${label}.domain`),
      transaction: positiveInteger(root.transaction, `${label}.transaction`),
    };
  }
  if (kind === 'declaration_error') {
    exactObject(value, ['kind', 'domain', 'transaction', 'code'], [], label);
    return {
      kind,
      domain: enumValue(root.domain, DECLARATION_ORDER, `${label}.domain`),
      transaction: positiveInteger(root.transaction, `${label}.transaction`),
      code: errorCode(root.code, `${label}.code`),
    };
  }
  if (kind === 'disconnect') {
    exactObject(value, ['kind', 'phase'], [], label);
    return {
      kind,
      phase: enumValue(
        root.phase,
        ['before_send', 'sent', 'accepted', 'ready'] as const,
        `${label}.phase`,
      ),
    };
  }
  if (kind === 'operation') {
    const operation = enumValue(
      root.operation,
      ['state_set', 'event', 'call'] as const,
      `${label}.operation`,
    );
    exactObject(
      value,
      operation === 'call'
        ? ['kind', 'operation_id', 'operation', 'phase', 'idempotency_key']
        : ['kind', 'operation_id', 'operation', 'phase'],
      [],
      label,
    );
    let idempotencyKey: string | null | undefined;
    if (operation === 'call') {
      if (root.idempotency_key !== null) {
        idempotencyKey = boundedString(root.idempotency_key, `${label}.idempotency_key`);
      } else {
        idempotencyKey = null;
      }
    }
    return {
      kind,
      operation_id: contractId(root.operation_id, `${label}.operation_id`),
      operation,
      phase: enumValue(root.phase, ['before_send', 'sent', 'accepted'] as const, `${label}.phase`),
      ...(operation === 'call' ? { idempotency_key: idempotencyKey! } : {}),
    };
  }
  if (kind === 'call_progress' || kind === 'call_result') {
    exactObject(value, ['kind', 'operation_id', 'value'], [], label);
    validateJsonValue(root.value, `${label}.value`);
    return { kind, operation_id: contractId(root.operation_id, `${label}.operation_id`), value: root.value };
  }
  if (kind === 'call_cancel') {
    exactObject(value, ['kind', 'operation_id'], [], label);
    return {
      kind,
      operation_id: contractId(root.operation_id, `${label}.operation_id`),
    };
  }
  if (kind === 'operation_terminal') {
    exactObject(value, ['kind', 'operation_id', 'outcome'], [], label);
    return {
      kind,
      operation_id: contractId(root.operation_id, `${label}.operation_id`),
      outcome: enumValue(
        root.outcome,
        ['not_dispatched', 'applied', 'failed', 'outcome_unknown'] as const,
        `${label}.outcome`,
      ),
    };
  }
  if (kind === 'operation_error') {
    exactObject(value, ['kind', 'operation_id', 'code'], [], label);
    return {
      kind,
      operation_id: contractId(root.operation_id, `${label}.operation_id`),
      code: errorCode(root.code, `${label}.code`),
    };
  }
  if (kind === 'presence') {
    exactObject(value, ['kind', 'entries'], [], label);
    return {
      kind,
      entries: denseArray(root.entries, CONTRACT_LIMITS.traceEntries, `${label}.entries`)
        .map((entry, index) => validatePresence(entry, `${label}.entries[${index}]`)),
    };
  }
  if (kind === 'state_publish') {
    exactObject(value, ['kind', 'paths'], [], label);
    const paths = denseArray(root.paths, CONTRACT_LIMITS.traceEntries, `${label}.paths`)
      .map((entry, index) => boundedString(entry, `${label}.paths[${index}]`));
    if (new Set(paths).size !== paths.length) fail('duplicate', `${label}.paths contains duplicates`);
    return { kind, paths };
  }
  exactObject(value, ['kind', 'effect'], [], label);
  return {
    kind,
    effect: enumValue(
      root.effect,
      ['device_command', 'notification_intent', 'unclassified'] as const,
      `${label}.effect`,
    ),
  };
}

function validateObservation(value: unknown, label: string): ContractObservation {
  const root = exactObject(value, [
    'statuses',
    'status_checkpoints',
    'lifecycle_promises',
    'access_reasons',
    'declarations',
    'declaration_snapshots',
    'declaration_promises',
    'declaration_visibility',
    'operations',
    'call_streams',
    'presence',
    'state_publications',
    'effects',
    'errors',
    'resources',
  ], [], label);

  const statuses = denseArray(root.statuses, CONTRACT_LIMITS.traceEntries, `${label}.statuses`)
    .map((entry, index) => enumValue(entry, [
      'idle',
      'connecting',
      'authenticating',
      'synchronizing',
      'ready',
      'reconnecting',
      'draining',
      'stopping',
      'stopped',
    ] as const, `${label}.statuses[${index}]`));
  const statusCheckpoints = denseArray(
    root.status_checkpoints,
    CONTRACT_LIMITS.traceEntries,
    `${label}.status_checkpoints`,
  ).map((entry, index) => {
    const entryLabel = `${label}.status_checkpoints[${index}]`;
    const record = exactObject(entry, ['stimulus_index', 'status'], [], entryLabel);
    return {
      stimulus_index: nonNegativeInteger(
        record.stimulus_index,
        `${entryLabel}.stimulus_index`,
      ),
      status: enumValue(record.status, [
        'idle',
        'connecting',
        'authenticating',
        'synchronizing',
        'ready',
        'reconnecting',
        'draining',
        'stopping',
        'stopped',
      ] as const, `${entryLabel}.status`),
    };
  });
  const lifecyclePromises = denseArray(
    root.lifecycle_promises,
    CONTRACT_LIMITS.traceEntries,
    `${label}.lifecycle_promises`,
  ).map((entry, index) => {
    const entryLabel = `${label}.lifecycle_promises[${index}]`;
    const record = exactObject(entry, [
      'operation',
      'promise_id',
      'invocation_stimulus_index',
      'settlement_stimulus_index',
      'outcome',
    ], ['code', 'session_id', 'generation'], entryLabel);
    const operation = enumValue(
      record.operation,
      ['start', 'stop'] as const,
      `${entryLabel}.operation`,
    );
    const outcome = enumValue(
      record.outcome,
      ['resolved', 'rejected'] as const,
      `${entryLabel}.outcome`,
    );
    const common = {
      operation,
      promise_id: contractId(record.promise_id, `${entryLabel}.promise_id`),
      invocation_stimulus_index: nonNegativeInteger(
        record.invocation_stimulus_index,
        `${entryLabel}.invocation_stimulus_index`,
      ),
      settlement_stimulus_index: nonNegativeInteger(
        record.settlement_stimulus_index,
        `${entryLabel}.settlement_stimulus_index`,
      ),
      outcome,
    };
    if (outcome === 'rejected') {
      if (operation !== 'start') {
        fail('invalid_trace', `${entryLabel} rejects an idempotent stop promise`);
      }
      exactObject(entry, [
        'operation',
        'promise_id',
        'invocation_stimulus_index',
        'settlement_stimulus_index',
        'outcome',
        'code',
      ], [], entryLabel);
      return { ...common, code: errorCode(record.code, `${entryLabel}.code`) };
    }
    if (operation === 'start') {
      exactObject(entry, [
        'operation',
        'promise_id',
        'invocation_stimulus_index',
        'settlement_stimulus_index',
        'outcome',
        'session_id',
        'generation',
      ], [], entryLabel);
      return {
        ...common,
        session_id: positiveInteger(record.session_id, `${entryLabel}.session_id`),
        generation: positiveInteger(record.generation, `${entryLabel}.generation`),
      };
    }
    exactObject(entry, [
      'operation',
      'promise_id',
      'invocation_stimulus_index',
      'settlement_stimulus_index',
      'outcome',
    ], [], entryLabel);
    return common;
  });
  const accessReasons = denseArray(root.access_reasons, CONTRACT_LIMITS.traceEntries, `${label}.access_reasons`)
    .map((entry, index) => enumValue(entry, ['initial', 'reauth', 'reconnect'] as const, `${label}.access_reasons[${index}]`));
  const declarations = denseArray(root.declarations, CONTRACT_LIMITS.traceEntries, `${label}.declarations`)
    .map((entry, index) => {
      const record = exactObject(entry, ['domain', 'generation', 'transaction'], [], `${label}.declarations[${index}]`);
      return {
        domain: enumValue(record.domain, DECLARATION_ORDER, `${label}.declarations[${index}].domain`),
        generation: positiveInteger(record.generation, `${label}.declarations[${index}].generation`),
        transaction: positiveInteger(record.transaction, `${label}.declarations[${index}].transaction`),
      };
    });
  const declarationSnapshots = denseArray(
    root.declaration_snapshots,
    CONTRACT_LIMITS.traceEntries,
    `${label}.declaration_snapshots`,
  ).map((entry, index) => {
    const entryLabel = `${label}.declaration_snapshots[${index}]`;
    const record = exactObject(
      entry,
      ['generation', 'transaction', 'stimulus_index', 'revisions'],
      [],
      entryLabel,
    );
    return {
      generation: positiveInteger(record.generation, `${entryLabel}.generation`),
      transaction: positiveInteger(record.transaction, `${entryLabel}.transaction`),
      stimulus_index: nonNegativeInteger(
        record.stimulus_index,
        `${entryLabel}.stimulus_index`,
      ),
      revisions: declarationRevisions(record.revisions, `${entryLabel}.revisions`),
    };
  });
  const declarationPromises = denseArray(
    root.declaration_promises,
    CONTRACT_LIMITS.traceEntries,
    `${label}.declaration_promises`,
  ).map((entry, index) => {
    const entryLabel = `${label}.declaration_promises[${index}]`;
    const record = exactObject(
      entry,
      ['promise_id', 'transaction', 'stimulus_index', 'outcome'],
      ['code'],
      entryLabel,
    );
    const outcome = enumValue(
      record.outcome,
      ['activated', 'rejected'] as const,
      `${entryLabel}.outcome`,
    );
    if (outcome === 'rejected') {
      exactObject(
        entry,
        ['promise_id', 'transaction', 'stimulus_index', 'outcome', 'code'],
        [],
        entryLabel,
      );
    } else {
      exactObject(
        entry,
        ['promise_id', 'transaction', 'stimulus_index', 'outcome'],
        [],
        entryLabel,
      );
    }
    return {
      promise_id: contractId(record.promise_id, `${entryLabel}.promise_id`),
      transaction: positiveInteger(record.transaction, `${entryLabel}.transaction`),
      stimulus_index: nonNegativeInteger(
        record.stimulus_index,
        `${entryLabel}.stimulus_index`,
      ),
      outcome,
      ...(outcome === 'rejected'
        ? { code: errorCode(record.code, `${entryLabel}.code`) }
        : {}),
    };
  });
  const declarationVisibility = denseArray(
    root.declaration_visibility,
    CONTRACT_LIMITS.traceEntries,
    `${label}.declaration_visibility`,
  ).map((entry, index) => enumValue(
    entry,
    ['none', 'previous', 'desired'] as const,
    `${label}.declaration_visibility[${index}]`,
  ));
  const operations = denseArray(root.operations, CONTRACT_LIMITS.traceEntries, `${label}.operations`)
    .map((entry, index) => {
      const entryLabel = `${label}.operations[${index}]`;
      const record = exactObject(
        entry,
        ['operation_id', 'operation', 'attempts', 'outcome'],
        ['idempotency_key'],
        entryLabel,
      );
      const operation = enumValue(
        record.operation,
        ['state_set', 'event', 'call'] as const,
        `${entryLabel}.operation`,
      );
      exactObject(
        entry,
        operation === 'call'
          ? ['operation_id', 'operation', 'attempts', 'outcome', 'idempotency_key']
          : ['operation_id', 'operation', 'attempts', 'outcome'],
        [],
        entryLabel,
      );
      let idempotencyKey: string | null | undefined;
      if (operation === 'call') {
        idempotencyKey = record.idempotency_key === null
          ? null
          : boundedString(record.idempotency_key, `${entryLabel}.idempotency_key`);
      }
      return {
        operation_id: contractId(record.operation_id, `${entryLabel}.operation_id`),
        operation,
        attempts: nonNegativeInteger(record.attempts, `${entryLabel}.attempts`),
        outcome: enumValue(record.outcome, [
          'not_dispatched',
          'sent',
          'applied',
          'succeeded',
          'failed',
          'outcome_unknown',
        ] as const, `${entryLabel}.outcome`),
        ...(operation === 'call' ? { idempotency_key: idempotencyKey! } : {}),
      };
    });
  const callStreams = denseArray(root.call_streams, CONTRACT_LIMITS.traceEntries, `${label}.call_streams`)
    .map((entry, index) => {
      const entryLabel = `${label}.call_streams[${index}]`;
      const record = exactObject(
        entry,
        ['operation_id', 'acceptance', 'progress', 'terminal'],
        [],
        entryLabel,
      );
      const acceptance = enumValue(
        record.acceptance,
        ['resolved', 'rejected'] as const,
        `${entryLabel}.acceptance`,
      );
      const progress = denseArray(record.progress, CONTRACT_LIMITS.traceEntries, `${entryLabel}.progress`)
        .map((value, progressIndex) => {
          validateJsonValue(value, `${entryLabel}.progress[${progressIndex}]`);
          return value;
        });
      const terminal = exactObject(record.terminal, ['kind'], ['value', 'code'], `${entryLabel}.terminal`);
      const terminalKind = enumValue(
        terminal.kind,
        ['result', 'error'] as const,
        `${entryLabel}.terminal.kind`,
      );
      if (terminalKind === 'result') {
        exactObject(record.terminal, ['kind', 'value'], [], `${entryLabel}.terminal`);
        validateJsonValue(terminal.value, `${entryLabel}.terminal.value`);
        return {
          operation_id: contractId(record.operation_id, `${entryLabel}.operation_id`),
          acceptance,
          progress,
          terminal: { kind: terminalKind, value: terminal.value },
        };
      }
      exactObject(record.terminal, ['kind', 'code'], [], `${entryLabel}.terminal`);
      return {
        operation_id: contractId(record.operation_id, `${entryLabel}.operation_id`),
        acceptance,
        progress,
        terminal: {
          kind: terminalKind,
          code: enumValue(
            terminal.code,
            ['not_dispatched', 'failed', 'outcome_unknown'] as const,
            `${entryLabel}.terminal.code`,
          ),
        },
      };
    });
  const presence = denseArray(root.presence, CONTRACT_LIMITS.traceEntries, `${label}.presence`)
    .map((snapshot, index) => denseArray(snapshot, CONTRACT_LIMITS.traceEntries, `${label}.presence[${index}]`)
      .map((entry, entryIndex) => validatePresence(entry, `${label}.presence[${index}][${entryIndex}]`)));
  const effects = denseArray(root.effects, CONTRACT_LIMITS.traceEntries, `${label}.effects`)
    .map((entry, index) => {
      const record = exactObject(entry, ['effect', 'destination'], [], `${label}.effects[${index}]`);
      return {
        effect: enumValue(record.effect, ['device_command', 'notification_intent', 'unclassified'] as const, `${label}.effects[${index}].effect`),
        destination: enumValue(record.destination, ['recorder', 'live', 'rejected'] as const, `${label}.effects[${index}].destination`),
      };
    });
  const errors = denseArray(root.errors, CONTRACT_LIMITS.traceEntries, `${label}.errors`)
    .map((entry, index) => {
      const entryLabel = `${label}.errors[${index}]`;
      const record = exactObject(
        entry,
        ['code', 'stimulus_index'],
        ['correlation'],
        entryLabel,
      );
      const code = errorCode(record.code, `${entryLabel}.code`);
      const stimulusIndex = nonNegativeInteger(
        record.stimulus_index,
        `${entryLabel}.stimulus_index`,
      );
      if (!Object.hasOwn(record, 'correlation')) {
        return { code, stimulus_index: stimulusIndex };
      }
      const correlation = exactObject(
        record.correlation,
        ['kind', 'local_id'],
        [],
        `${entryLabel}.correlation`,
      );
      return {
        code,
        stimulus_index: stimulusIndex,
        correlation: {
          kind: enumValue(
            correlation.kind,
            ['event', 'call'] as const,
            `${entryLabel}.correlation.kind`,
          ),
          local_id: contractId(
            correlation.local_id,
            `${entryLabel}.correlation.local_id`,
          ),
        },
      };
    });
  const resources = exactObject(
    root.resources,
    ['sockets', 'socket_high_water', 'timers', 'listeners', 'iterators'],
    [],
    `${label}.resources`,
  );

  return {
    statuses,
    status_checkpoints: statusCheckpoints,
    lifecycle_promises: lifecyclePromises,
    access_reasons: accessReasons,
    declarations,
    declaration_snapshots: declarationSnapshots,
    declaration_promises: declarationPromises,
    declaration_visibility: declarationVisibility,
    operations,
    call_streams: callStreams,
    presence,
    state_publications: nonNegativeInteger(root.state_publications, `${label}.state_publications`),
    effects,
    errors,
    resources: {
      sockets: nonNegativeInteger(resources.sockets, `${label}.resources.sockets`),
      socket_high_water: nonNegativeInteger(
        resources.socket_high_water,
        `${label}.resources.socket_high_water`,
      ),
      timers: resourceCount(resources.timers, `${label}.resources.timers`),
      listeners: resourceCount(resources.listeners, `${label}.resources.listeners`),
      iterators: resourceCount(resources.iterators, `${label}.resources.iterators`),
    },
  };
}

function assertDeclarationOrder(scenario: CoordinatorContractScenario): void {
  const desired = scenario.setup.desired_declarations;
  const canonicalDesired = DECLARATION_ORDER.filter((domain) => desired.includes(domain));
  if (desired.some((domain, index) => domain !== canonicalDesired[index])) {
    fail('invalid_order', `${scenario.id} desired declarations are not in barrier order`);
  }
  if (scenario.setup.mode === 'sdk' && desired.length !== DECLARATION_ORDER.length) {
    fail('missing_trace', `${scenario.id} must stage all five complete declaration slices`);
  }

  const byTransaction = new Map<string, DeclarationDomain[]>();
  let previousGeneration = 0;
  let previousTransaction = 0;
  for (const declaration of scenario.expected.declarations) {
    if (declaration.generation < previousGeneration
      || (declaration.generation === previousGeneration
        && declaration.transaction < previousTransaction)) {
      fail('invalid_order', `${scenario.id} declaration transactions are not monotonic`);
    }
    if (declaration.generation !== previousGeneration) previousTransaction = 0;
    previousGeneration = declaration.generation;
    previousTransaction = declaration.transaction;
    const key = `${declaration.generation}:${declaration.transaction}`;
    const domains = byTransaction.get(key) ?? [];
    domains.push(declaration.domain);
    byTransaction.set(key, domains);
  }
  for (const [transaction, domains] of byTransaction) {
    if (domains.length > desired.length
      || domains.some((domain, index) => domain !== desired[index])) {
      fail('invalid_order', `${scenario.id} transaction ${transaction} does not use declaration order`);
    }
  }

  if (desired.length > 0
    && scenario.expected.statuses.includes('ready')
    && byTransaction.size === 0) {
    fail('missing_trace', `${scenario.id} reaches ready without its declaration barrier`);
  }
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => jsonValuesEqual(entry, right[index]!));
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index]
        && jsonValuesEqual(left[key] as JsonValue, right[key] as JsonValue)
      ));
  }
  return false;
}

interface DerivedOperation {
  stimulus: Extract<ContractStimulus, { kind: 'operation' }>;
  attempts: number;
  outcome?: OperationOutcome;
}

interface DerivedCall {
  operationId: string;
  acceptance: CallStreamTrace['acceptance'];
  progress: JsonValue[];
  terminal?: CallStreamTrace['terminal'];
  cancellationRequested: boolean;
  pendingError?: { code: string };
}

function assertLifecycleCausality(scenario: CoordinatorContractScenario): void {
  if (scenario.setup.mode !== 'sdk') {
    if (scenario.expected.statuses.length !== 0
      || scenario.expected.status_checkpoints.length !== 0
      || scenario.expected.lifecycle_promises.length !== 0) {
      fail('invalid_trace', `${scenario.id} reports SDK lifecycle outside SDK mode`);
    }
    return;
  }

  const statuses: CoordinatorStatus[] = [];
  const checkpoints: StatusCheckpointTrace[] = [];
  const lifecyclePromises: LifecyclePromiseTrace[] = [];
  let started = false;
  let stopped = false;
  let reconnecting = false;
  let sessionActivated = false;
  let canRestoreReady = false;
  let currentSession: { sessionId: number; generation: number } | undefined;
  let pendingStart: { promiseId: string; invocationIndex: number } | undefined;
  let stopPromise: { promiseId: string; settlementIndex: number } | undefined;
  let declarationTransaction: { transaction: number; handedOff: boolean } | undefined;
  let queuedDeclarationTransaction: number | undefined;
  const seenLifecyclePromiseIds = new Set<string>();
  const record = (stimulusIndex: number, ...next: CoordinatorStatus[]): void => {
    for (const status of next) {
      statuses.push(status);
      checkpoints.push({ stimulus_index: stimulusIndex, status });
    }
  };
  const settleStart = (
    settlementIndex: number,
    outcome: 'resolved' | 'rejected',
    code?: string,
  ): void => {
    if (pendingStart === undefined) return;
    lifecyclePromises.push({
      operation: 'start',
      promise_id: pendingStart.promiseId,
      invocation_stimulus_index: pendingStart.invocationIndex,
      settlement_stimulus_index: settlementIndex,
      outcome,
      ...(outcome === 'resolved'
        ? {
          session_id: currentSession!.sessionId,
          generation: currentSession!.generation,
        }
        : { code: code! }),
    });
    pendingStart = undefined;
  };
  for (let stimulusIndex = 0; stimulusIndex < scenario.stimuli.length; stimulusIndex += 1) {
    const stimulus = scenario.stimuli[stimulusIndex]!;
    if (stimulus.kind === 'construct') {
      if (scenario.stimuli.length !== 1) {
        fail('invalid_lifecycle', `${scenario.id} mixes construction probing with active stimuli`);
      }
      record(stimulusIndex, 'idle');
    } else if (stimulus.kind === 'start') {
      if (!started && !stopped) {
        if (seenLifecyclePromiseIds.has(stimulus.promise_id)) {
          fail('duplicate', `${scenario.id} reuses lifecycle promise ${stimulus.promise_id}`);
        }
        seenLifecyclePromiseIds.add(stimulus.promise_id);
        started = true;
        pendingStart = { promiseId: stimulus.promise_id, invocationIndex: stimulusIndex };
        record(stimulusIndex, 'connecting');
      } else {
        if (seenLifecyclePromiseIds.has(stimulus.promise_id)) {
          fail('duplicate', `${scenario.id} reuses lifecycle promise ${stimulus.promise_id}`);
        }
        seenLifecyclePromiseIds.add(stimulus.promise_id);
        lifecyclePromises.push({
          operation: 'start',
          promise_id: stimulus.promise_id,
          invocation_stimulus_index: stimulusIndex,
          settlement_stimulus_index: stimulusIndex,
          outcome: 'rejected',
          code: 'invalid_lifecycle',
        });
      }
    } else if (stimulus.kind === 'welcome') {
      if (!started || stopped) {
        fail('invalid_lifecycle', `${scenario.id} receives welcome outside a started lifecycle`);
      }
      if (reconnecting) record(stimulusIndex, 'connecting');
      record(stimulusIndex, 'authenticating', 'synchronizing');
      reconnecting = false;
      sessionActivated = false;
      canRestoreReady = false;
      currentSession = { sessionId: stimulus.session_id, generation: stimulus.generation };
      declarationTransaction = { transaction: 1, handedOff: false };
      queuedDeclarationTransaction = undefined;
    } else if (stimulus.kind === 'declaration_update') {
      if (!started || stopped) {
        fail('invalid_lifecycle', `${scenario.id} replaces declarations without an active session`);
      }
      const startsSynchronization = sessionActivated;
      canRestoreReady = canRestoreReady || sessionActivated;
      sessionActivated = false;
      if (startsSynchronization) record(stimulusIndex, 'synchronizing');
      if (declarationTransaction?.handedOff === true) {
        queuedDeclarationTransaction = stimulus.transaction;
      } else {
        declarationTransaction = { transaction: stimulus.transaction, handedOff: false };
      }
    } else if (stimulus.kind === 'declaration_handoff') {
      if (declarationTransaction === undefined
        || declarationTransaction.transaction !== stimulus.transaction
        || declarationTransaction.handedOff) {
        fail('invalid_order', `${scenario.id} hands off an inactive declaration transaction`);
      }
      declarationTransaction.handedOff = true;
    } else if (stimulus.kind === 'declaration_ack' && stimulus.domain === 'functions') {
      if (queuedDeclarationTransaction !== undefined) {
        declarationTransaction = {
          transaction: queuedDeclarationTransaction,
          handedOff: false,
        };
        queuedDeclarationTransaction = undefined;
      } else {
        declarationTransaction = undefined;
        sessionActivated = true;
        canRestoreReady = false;
        record(stimulusIndex, 'ready');
        settleStart(stimulusIndex, 'resolved');
      }
    } else if (stimulus.kind === 'declaration_error') {
      declarationTransaction = undefined;
      queuedDeclarationTransaction = undefined;
      if (canRestoreReady) {
        sessionActivated = true;
        canRestoreReady = false;
        record(stimulusIndex, 'ready');
      }
    } else if (stimulus.kind === 'disconnect' && started && !stopped) {
      if (!reconnecting) record(stimulusIndex, 'reconnecting');
      reconnecting = true;
      sessionActivated = false;
      canRestoreReady = false;
      declarationTransaction = undefined;
      queuedDeclarationTransaction = undefined;
    } else if (stimulus.kind === 'stop') {
      if (started && !stopped) {
        record(stimulusIndex, 'stopping', 'stopped');
        stopped = true;
        reconnecting = false;
        sessionActivated = false;
        canRestoreReady = false;
        declarationTransaction = undefined;
        queuedDeclarationTransaction = undefined;
        settleStart(stimulusIndex, 'rejected', 'cancelled');
      }
      if (stopPromise === undefined) {
        if (seenLifecyclePromiseIds.has(stimulus.promise_id)) {
          fail('duplicate', `${scenario.id} reuses lifecycle promise ${stimulus.promise_id}`);
        }
        seenLifecyclePromiseIds.add(stimulus.promise_id);
        stopPromise = { promiseId: stimulus.promise_id, settlementIndex: stimulusIndex };
      } else if (stimulus.promise_id !== stopPromise.promiseId) {
        fail('invalid_trace', `${scenario.id} repeated stop does not return the shared promise`);
      }
      lifecyclePromises.push({
        operation: 'stop',
        promise_id: stimulus.promise_id,
        invocation_stimulus_index: stimulusIndex,
        settlement_stimulus_index: stopPromise.settlementIndex,
        outcome: 'resolved',
      });
    }
  }

  if (pendingStart !== undefined) {
    fail('missing_trace', `${scenario.id} leaves its start promise unsettled`);
  }

  if (statuses.length !== scenario.expected.statuses.length
    || statuses.some((status, index) => scenario.expected.statuses[index] !== status)) {
    fail('invalid_trace', `${scenario.id} lifecycle statuses do not match their causal stimuli`);
  }
  if (checkpoints.length !== scenario.expected.status_checkpoints.length
    || checkpoints.some((checkpoint, index) => {
      const observed = scenario.expected.status_checkpoints[index];
      return observed?.stimulus_index !== checkpoint.stimulus_index
        || observed.status !== checkpoint.status;
    })) {
    fail('invalid_trace', `${scenario.id} lifecycle checkpoints do not match stimulus timing`);
  }
  lifecyclePromises.sort((left, right) => (
    left.invocation_stimulus_index - right.invocation_stimulus_index
  ));
  if (lifecyclePromises.length !== scenario.expected.lifecycle_promises.length
    || lifecyclePromises.some((promise, index) => {
      const observed = scenario.expected.lifecycle_promises[index];
      return observed?.operation !== promise.operation
        || observed.promise_id !== promise.promise_id
        || observed.invocation_stimulus_index !== promise.invocation_stimulus_index
        || observed.settlement_stimulus_index !== promise.settlement_stimulus_index
        || observed.outcome !== promise.outcome
        || observed.code !== promise.code
        || observed.session_id !== promise.session_id
        || observed.generation !== promise.generation;
    })) {
    fail('invalid_trace', `${scenario.id} lifecycle promises do not match their causal settlement`);
  }

  const startCount = scenario.stimuli.filter(({ kind }) => kind === 'start').length;
  const duplicateStartErrors = scenario.expected.errors.filter(
    ({ code, correlation }) => code === 'invalid_lifecycle' && correlation === undefined,
  ).length;
  if (duplicateStartErrors !== Math.max(0, startCount - 1)) {
    fail('missing_trace', `${scenario.id} duplicate starts do not have exact lifecycle errors`);
  }

  const accessReasons: TokenReason[] = startCount > 0 ? ['initial'] : [];
  let disconnected = false;
  for (const stimulus of scenario.stimuli) {
    if (stimulus.kind === 'disconnect') disconnected = true;
    else if (stimulus.kind === 'welcome' && disconnected) {
      accessReasons.push('reconnect');
      disconnected = false;
    }
  }
  if (accessReasons.length !== scenario.expected.access_reasons.length
    || accessReasons.some((reason, index) => scenario.expected.access_reasons[index] !== reason)) {
    fail('invalid_trace', `${scenario.id} access-token reasons do not match lifecycle stimuli`);
  }
}

function assertOperationCausality(scenario: CoordinatorContractScenario): void {
  const operations = new Map<string, DerivedOperation>();
  const operationOrder: DerivedOperation[] = [];
  const calls = new Map<string, DerivedCall>();
  let started = false;
  let ready = false;
  let activeConfiguration = false;
  let canRestoreReady = false;
  let declarationTransaction: { transaction: number; handedOff: boolean } | undefined;
  let queuedDeclarationTransaction: number | undefined;

  const finalize = (
    operationId: string,
    outcome: OperationOutcome,
    terminal?: CallStreamTrace['terminal'],
  ): void => {
    const operation = operations.get(operationId);
    if (operation === undefined) {
      fail('invalid_reference', `${scenario.id} terminates unknown operation ${operationId}`);
    }
    if (operation.outcome !== undefined) {
      fail('invalid_order', `${scenario.id} terminates operation ${operationId} more than once`);
    }
    operation.outcome = outcome;
    if (operation.stimulus.operation === 'call') {
      const call = calls.get(operationId)!;
      if (terminal === undefined) {
        fail('missing_trace', `${scenario.id} does not close call handle ${operationId}`);
      }
      call.terminal = terminal;
    } else if (terminal !== undefined) {
      fail('invalid_reference', `${scenario.id} attaches call evidence to ${operationId}`);
    }
  };

  for (const stimulus of scenario.stimuli) {
    if (scenario.setup.mode === 'sdk') {
      if (stimulus.kind === 'start' && !started) {
        started = true;
        ready = false;
        canRestoreReady = false;
      } else if (stimulus.kind === 'welcome') {
        ready = false;
        canRestoreReady = false;
        declarationTransaction = { transaction: 1, handedOff: false };
        queuedDeclarationTransaction = undefined;
      } else if (stimulus.kind === 'declaration_update') {
        canRestoreReady = canRestoreReady || (ready && activeConfiguration);
        ready = false;
        if (declarationTransaction?.handedOff === true) {
          queuedDeclarationTransaction = stimulus.transaction;
        } else {
          declarationTransaction = { transaction: stimulus.transaction, handedOff: false };
        }
      } else if (stimulus.kind === 'declaration_handoff') {
        if (declarationTransaction?.transaction === stimulus.transaction) {
          declarationTransaction.handedOff = true;
        }
      } else if (stimulus.kind === 'disconnect' || stimulus.kind === 'stop') {
        ready = false;
        canRestoreReady = false;
        declarationTransaction = undefined;
        queuedDeclarationTransaction = undefined;
      } else if (stimulus.kind === 'declaration_ack' && stimulus.domain === 'functions') {
        activeConfiguration = true;
        if (queuedDeclarationTransaction !== undefined) {
          declarationTransaction = {
            transaction: queuedDeclarationTransaction,
            handedOff: false,
          };
          queuedDeclarationTransaction = undefined;
        } else {
          declarationTransaction = undefined;
          ready = true;
          canRestoreReady = false;
        }
      } else if (stimulus.kind === 'declaration_error') {
        ready = canRestoreReady;
        canRestoreReady = false;
        declarationTransaction = undefined;
        queuedDeclarationTransaction = undefined;
      }
    }
    if (stimulus.kind === 'operation') {
      if (operations.has(stimulus.operation_id)) {
        fail('duplicate', `${scenario.id} contains duplicate operation stimuli`);
      }
      if (stimulus.phase === 'accepted' && stimulus.operation !== 'call') {
        fail('invalid_outcome', `${scenario.id} accepts a non-call operation`);
      }
      if (scenario.setup.mode === 'sdk'
        && stimulus.phase !== 'before_send'
        && !ready) {
        fail('invalid_lifecycle', `${scenario.id} dispatches ${stimulus.operation_id} while not ready`);
      }
      const operation: DerivedOperation = {
        stimulus,
        attempts: stimulus.phase === 'before_send' ? 0 : 1,
      };
      operations.set(stimulus.operation_id, operation);
      operationOrder.push(operation);
      if (stimulus.operation === 'call') {
        calls.set(stimulus.operation_id, {
          operationId: stimulus.operation_id,
          acceptance: stimulus.phase === 'accepted' ? 'resolved' : 'rejected',
          progress: [],
          cancellationRequested: false,
        });
      }
      if (stimulus.phase === 'before_send') {
        finalize(
          stimulus.operation_id,
          'not_dispatched',
          stimulus.operation === 'call'
            ? { kind: 'error', code: 'not_dispatched' }
            : undefined,
        );
      } else if (stimulus.operation === 'event') {
        finalize(stimulus.operation_id, 'sent');
      }
    } else if (stimulus.kind === 'call_progress') {
      const operation = operations.get(stimulus.operation_id);
      const call = calls.get(stimulus.operation_id);
      if (operation?.stimulus.operation !== 'call'
        || operation.stimulus.phase !== 'accepted'
        || call === undefined
        || call.pendingError !== undefined
        || operation.outcome !== undefined) {
        fail('invalid_reference', `${scenario.id} streams an unaccepted call ${stimulus.operation_id}`);
      }
      call.progress.push(stimulus.value);
    } else if (stimulus.kind === 'call_result') {
      const operation = operations.get(stimulus.operation_id);
      if (operation?.stimulus.operation !== 'call'
        || operation.stimulus.phase !== 'accepted'
        || calls.get(stimulus.operation_id)?.pendingError !== undefined
        || operation.outcome !== undefined) {
        fail('invalid_reference', `${scenario.id} resolves an unaccepted call ${stimulus.operation_id}`);
      }
      finalize(stimulus.operation_id, 'succeeded', { kind: 'result', value: stimulus.value });
    } else if (stimulus.kind === 'call_cancel') {
      const operation = operations.get(stimulus.operation_id);
      const call = calls.get(stimulus.operation_id);
      if (operation?.stimulus.operation !== 'call'
        || operation.outcome !== undefined
        || call === undefined
        || call.pendingError !== undefined
        || call.cancellationRequested) {
        fail('invalid_reference', `${scenario.id} cancels an inactive call ${stimulus.operation_id}`);
      }
      call.cancellationRequested = true;
    } else if (stimulus.kind === 'operation_error') {
      const operation = operations.get(stimulus.operation_id);
      if (operation?.stimulus.operation === 'call') {
        const call = calls.get(stimulus.operation_id)!;
        if (operation.stimulus.phase === 'before_send'
          || operation.outcome !== undefined
          || call.pendingError !== undefined) {
          fail('invalid_reference', `${scenario.id} errors an inactive call ${stimulus.operation_id}`);
        }
        call.pendingError = { code: stimulus.code };
      }
    } else if (stimulus.kind === 'operation_terminal') {
      const operation = operations.get(stimulus.operation_id);
      if (operation === undefined || operation.outcome !== undefined) {
        fail('invalid_reference', `${scenario.id} terminal references an inactive operation`);
      }
      const { operation: kind, phase } = operation.stimulus;
      if (kind === 'call') {
        const call = calls.get(stimulus.operation_id)!;
        if (call.pendingError === undefined) {
          fail('missing_trace', `${scenario.id} settles CALL_ERROR without its correlated error`);
        }
        let expectedOutcome: 'not_dispatched' | 'failed' | 'outcome_unknown';
        if (call.pendingError.code === 'outcome_unknown') {
          expectedOutcome = 'outcome_unknown';
        } else {
          expectedOutcome = phase === 'accepted' ? 'failed' : 'not_dispatched';
        }
        if (call.cancellationRequested) {
          const expectedCancellationCode = phase === 'accepted' ? 'outcome_unknown' : 'cancelled';
          if (call.pendingError.code !== expectedCancellationCode) {
            fail('invalid_outcome', `${scenario.id} cancellation terminal has the wrong relay code`);
          }
        }
        if (stimulus.outcome !== expectedOutcome) {
          fail('invalid_outcome', `${scenario.id} CALL_ERROR has an impossible terminal outcome`);
        }
        delete call.pendingError;
      } else if (kind === 'event'
        || stimulus.outcome === 'applied' && kind !== 'state_set'
        || stimulus.outcome === 'not_dispatched' && phase !== 'sent'
        || stimulus.outcome === 'outcome_unknown' && phase === 'before_send') {
        fail('invalid_outcome', `${scenario.id} has an impossible terminal outcome`);
      }
      finalize(
        stimulus.operation_id,
        stimulus.outcome,
        kind === 'call'
          ? { kind: 'error', code: stimulus.outcome as 'not_dispatched' | 'failed' | 'outcome_unknown' }
          : undefined,
      );
    } else if (stimulus.kind === 'disconnect' || stimulus.kind === 'stop') {
      for (const operation of operationOrder) {
        if (operation.outcome !== undefined) continue;
        const kind = operation.stimulus.operation;
        if (kind === 'state_set') {
          finalize(operation.stimulus.operation_id, 'outcome_unknown');
        } else if (kind === 'call') {
          if (calls.get(operation.stimulus.operation_id)?.pendingError !== undefined) {
            fail('missing_trace', `${scenario.id} disconnects before settling a received CALL_ERROR`);
          }
          finalize(
            operation.stimulus.operation_id,
            'outcome_unknown',
            { kind: 'error', code: 'outcome_unknown' },
          );
        }
      }
    }
  }

  if (operationOrder.some(({ outcome }) => outcome === undefined)) {
    fail('missing_trace', `${scenario.id} leaves an operation or call handle unsettled`);
  }
  if (scenario.coverage.includes('offline_rejection')
    && (operationOrder.length === 0
      || operationOrder.some(({ stimulus }) => stimulus.phase !== 'before_send'))) {
    fail('missing_coverage', `${scenario.id} does not prove offline pre-send rejection`);
  }
  if (scenario.coverage.includes('call_cancellation')) {
    const cancelledPhases = new Set(operationOrder
      .filter(({ stimulus }) => (
        stimulus.operation === 'call'
        && calls.get(stimulus.operation_id)?.cancellationRequested === true
      ))
      .map(({ stimulus }) => stimulus.phase));
    if (!cancelledPhases.has('sent') || !cancelledPhases.has('accepted')) {
      fail('missing_coverage', `${scenario.id} does not prove pre- and post-accept cancellation`);
    }
  }
  if (scenario.expected.operations.length !== operationOrder.length) {
    fail('missing_trace', `${scenario.id} must observe every operation stimulus exactly once`);
  }
  for (let index = 0; index < operationOrder.length; index += 1) {
    const derived = operationOrder[index]!;
    const observed = scenario.expected.operations[index];
    if (observed !== undefined && observed.attempts > 1) {
      fail('unsafe_retry', `${scenario.id} retries effectful operation ${observed.operation_id}`);
    }
    if (observed?.operation_id !== derived.stimulus.operation_id
      || observed.operation !== derived.stimulus.operation
      || observed.attempts !== derived.attempts
      || observed.outcome !== derived.outcome
      || observed.idempotency_key !== derived.stimulus.idempotency_key) {
      fail('invalid_outcome', `${scenario.id} operation trace ${index} is not causally terminal`);
    }
  }

  const derivedCalls = operationOrder
    .filter(({ stimulus }) => stimulus.operation === 'call')
    .map(({ stimulus }) => calls.get(stimulus.operation_id)!);
  if (scenario.expected.call_streams.length !== derivedCalls.length) {
    fail('missing_trace', `${scenario.id} must settle every call handle exactly once`);
  }
  const streamIds = scenario.expected.call_streams.map(({ operation_id: operationId }) => operationId);
  if (new Set(streamIds).size !== streamIds.length) {
    fail('duplicate', `${scenario.id} contains duplicate call-handle traces`);
  }
  for (let index = 0; index < derivedCalls.length; index += 1) {
    const derived = derivedCalls[index]!;
    const observed = scenario.expected.call_streams[index];
    if (derived.terminal === undefined || observed === undefined
      || observed.operation_id !== derived.operationId
      || observed.acceptance !== derived.acceptance
      || observed.progress.length !== derived.progress.length
      || observed.progress.some((value, progressIndex) => (
        !jsonValuesEqual(value, derived.progress[progressIndex]!)
      ))
      || observed.terminal.kind !== derived.terminal.kind
      || (observed.terminal.kind === 'result'
        && derived.terminal.kind === 'result'
        && !jsonValuesEqual(observed.terminal.value, derived.terminal.value))
      || (observed.terminal.kind === 'error'
        && derived.terminal.kind === 'error'
        && observed.terminal.code !== derived.terminal.code)) {
      fail('invalid_trace', `${scenario.id} call handle ${derived.operationId} differs from its stimuli`);
    }
  }
}

function assertErrorCausality(scenario: CoordinatorContractScenario): void {
  const operationStimuli = new Map<string, {
    stimulus: Extract<ContractStimulus, { kind: 'operation' }>;
    index: number;
  }>();
  const operationErrors: Array<{
    stimulus: Extract<ContractStimulus, { kind: 'operation_error' }>;
    index: number;
  }> = [];
  for (let index = 0; index < scenario.stimuli.length; index += 1) {
    const stimulus = scenario.stimuli[index]!;
    if (stimulus.kind === 'operation') {
      operationStimuli.set(stimulus.operation_id, { stimulus, index });
    } else if (stimulus.kind === 'operation_error') {
      operationErrors.push({ stimulus, index });
    }
  }
  const correlatedErrors = scenario.expected.errors.filter(
    (error): error is ErrorTrace & { correlation: NonNullable<ErrorTrace['correlation']> } => (
      error.correlation !== undefined
    ),
  );
  if (operationErrors.length !== correlatedErrors.length) {
    fail('missing_trace', `${scenario.id} correlated errors do not match their stimuli`);
  }
  const correlatedIds = correlatedErrors.map(({ correlation }) => correlation.local_id);
  if (new Set(correlatedIds).size !== correlatedIds.length) {
    fail('duplicate', `${scenario.id} contains duplicate correlated errors`);
  }
  for (const { stimulus, index } of operationErrors) {
    const operationEntry = operationStimuli.get(stimulus.operation_id);
    if (operationEntry === undefined
      || !['event', 'call'].includes(operationEntry.stimulus.operation)) {
      fail('invalid_reference', `${scenario.id} correlates an error to an invalid operation`);
    }
    if (operationEntry.stimulus.phase === 'before_send') {
      fail('invalid_order', `${scenario.id} receives a relay error for an operation never handed off`);
    }
    if (index <= operationEntry.index) {
      fail('invalid_order', `${scenario.id} delivers an operation error before handoff`);
    }
    const closingIndex = scenario.stimuli.findIndex((candidate, candidateIndex) => {
      if (candidateIndex <= operationEntry.index) return false;
      if (candidate.kind === 'disconnect' || candidate.kind === 'stop') return true;
      if (operationEntry.stimulus.operation !== 'call') return false;
      return (candidate.kind === 'operation_terminal'
          || candidate.kind === 'call_result')
        && candidate.operation_id === stimulus.operation_id;
    });
    if (closingIndex !== -1 && index >= closingIndex) {
      fail('invalid_order', `${scenario.id} delivers an operation error after its terminal boundary`);
    }
    const observed = correlatedErrors.find(({ correlation }) => (
      correlation.local_id === stimulus.operation_id
    ));
    if (observed?.code !== stimulus.code
      || observed.stimulus_index !== index
      || observed.correlation.kind !== operationEntry.stimulus.operation) {
      fail('invalid_trace', `${scenario.id} loses operation error correlation`);
    }
  }

  const expectedUncorrelated: Array<{ code: string; stimulus_index: number }> = [];
  let started = false;
  for (let index = 0; index < scenario.stimuli.length; index += 1) {
    const stimulus = scenario.stimuli[index]!;
    if (stimulus.kind === 'start') {
      if (started) expectedUncorrelated.push({ code: 'invalid_lifecycle', stimulus_index: index });
      started = true;
    } else if (stimulus.kind === 'declaration_error') {
      expectedUncorrelated.push({ code: stimulus.code, stimulus_index: index });
    } else if (stimulus.kind === 'effect' && stimulus.effect === 'unclassified') {
      expectedUncorrelated.push({ code: 'unclassified_effect', stimulus_index: index });
    }
  }
  const observedUncorrelated = scenario.expected.errors.filter(
    (error) => error.correlation === undefined,
  );
  if (observedUncorrelated.length !== expectedUncorrelated.length
    || expectedUncorrelated.some((expected, index) => {
      const observed = observedUncorrelated[index];
      return observed?.code !== expected.code
        || observed.stimulus_index !== expected.stimulus_index;
    })) {
    fail('invalid_trace', `${scenario.id} uncorrelated errors do not match causal stimuli`);
  }

  let previousErrorIndex = -1;
  for (const error of scenario.expected.errors) {
    if (error.stimulus_index < previousErrorIndex
      || error.stimulus_index >= scenario.stimuli.length) {
      fail('invalid_order', `${scenario.id} error checkpoints are not stimulus-ordered`);
    }
    previousErrorIndex = error.stimulus_index;
  }
}

function assertPresenceCausality(scenario: CoordinatorContractScenario): void {
  const snapshots: PresenceTrace[][] = [];
  let present = false;
  for (const stimulus of scenario.stimuli) {
    if (stimulus.kind === 'presence') {
      let previousSession = 0;
      for (const entry of stimulus.entries) {
        if (entry.session_id <= previousSession) {
          fail('invalid_order', `${scenario.id} presence is not unique and session-sorted`);
        }
        previousSession = entry.session_id;
      }
      snapshots.push(stimulus.entries);
      present = stimulus.entries.length > 0;
    } else if ((stimulus.kind === 'disconnect' || stimulus.kind === 'stop') && present) {
      snapshots.push([]);
      present = false;
    }
  }
  if (snapshots.length !== scenario.expected.presence.length
    || snapshots.some((snapshot, index) => {
      const observed = scenario.expected.presence[index];
      return observed === undefined
        || observed.length !== snapshot.length
        || snapshot.some((entry, entryIndex) => (
          observed[entryIndex]?.session_id !== entry.session_id
          || observed[entryIndex]?.user_id !== entry.user_id
        ));
    })) {
    fail('invalid_trace', `${scenario.id} presence snapshots do not match lifecycle stimuli`);
  }
}

function assertEffectAndPublicationCausality(scenario: CoordinatorContractScenario): void {
  const publicationCount = scenario.stimuli.filter(({ kind }) => kind === 'state_publish').length;
  if (scenario.expected.state_publications !== publicationCount) {
    fail('missing_trace', `${scenario.id} state publication trace count does not match its stimuli`);
  }
  const effects = scenario.stimuli.filter(
    (stimulus): stimulus is Extract<ContractStimulus, { kind: 'effect' }> => (
      stimulus.kind === 'effect'
    ),
  );
  const expectedDestination = (effect: EffectKind): EffectDestination => {
    if (effect === 'unclassified') return 'rejected';
    return scenario.setup.mode === 'sdk' ? 'live' : 'recorder';
  };
  if (effects.length !== scenario.expected.effects.length
    || effects.some(({ effect }, index) => scenario.expected.effects[index]?.effect !== effect)) {
    fail('missing_trace', `${scenario.id} effect traces do not match their stimuli`);
  }
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index]!.effect;
    if (scenario.expected.effects[index]!.destination !== expectedDestination(effect)) {
      fail('invalid_trace', `${scenario.id} ${effect} does not use its required destination`);
    }
  }
}

function assertDeclarationCausality(scenario: CoordinatorContractScenario): void {
  const declarations: DeclarationTrace[] = [];
  const snapshots: DeclarationSnapshotTrace[] = [];
  const promiseSettlements: DeclarationPromiseTrace[] = [];
  const visibility: ContractObservation['declaration_visibility'] = [];
  let generation: number | undefined;
  let lastTransaction = 0;
  let desiredRevisions = cloneRevisions(INITIAL_DECLARATION_REVISIONS);
  let activeRevisions: DeclarationRevisions | undefined;
  let declarationFailures = 0;
  let successfulActivationAfterFailure = false;
  type PendingPromise = { promiseId: string; transaction: number };
  interface TransactionState {
    transaction: number;
    revisions: DeclarationRevisions;
    nextDeclaration: number;
    handedOff: boolean;
    promises: PendingPromise[];
  }
  let current: TransactionState | undefined;
  let queued: TransactionState | undefined;
  let reconnectPromises: PendingPromise[] = [];
  const seenPromiseIds = new Set<string>();

  const settlePromises = (
    promises: PendingPromise[],
    stimulusIndex: number,
    outcome: DeclarationPromiseTrace['outcome'],
    code?: string,
  ): void => {
    for (const pending of promises) {
      promiseSettlements.push({
        promise_id: pending.promiseId,
        transaction: pending.transaction,
        stimulus_index: stimulusIndex,
        outcome,
        ...(code === undefined ? {} : { code }),
      });
    }
    promises.splice(0);
  };
  const startTransaction = (transaction: TransactionState, stimulusIndex: number): void => {
    if (generation === undefined) {
      fail('invalid_lifecycle', `${scenario.id} starts declarations before welcome`);
    }
    current = transaction;
    snapshots.push({
      generation,
      transaction: transaction.transaction,
      stimulus_index: stimulusIndex,
      revisions: cloneRevisions(transaction.revisions),
    });
  };
  const promisesFor = (
    stimulus: Extract<ContractStimulus, { kind: 'declaration_update' }>,
  ): PendingPromise[] => stimulus.promise_ids.map((promiseId) => {
    if (seenPromiseIds.has(promiseId)) {
      fail('duplicate', `${scenario.id} reuses declaration promise ${promiseId}`);
    }
    seenPromiseIds.add(promiseId);
    return { promiseId, transaction: stimulus.transaction };
  });
  const validateRevisionUpdate = (
    stimulus: Extract<ContractStimulus, { kind: 'declaration_update' }>,
  ): DeclarationRevisions => {
    const changed = new Set(stimulus.changed_domains);
    for (const domain of DECLARATION_ORDER) {
      if (changed.has(domain)) {
        if (stimulus.revisions[domain] === desiredRevisions[domain]) {
          fail('invalid_trace', `${scenario.id} does not revise changed slice ${domain}`);
        }
      } else if (stimulus.revisions[domain] !== desiredRevisions[domain]) {
        fail('invalid_trace', `${scenario.id} contaminates unchanged slice ${domain}`);
      }
    }
    return cloneRevisions(stimulus.revisions);
  };

  for (let stimulusIndex = 0; stimulusIndex < scenario.stimuli.length; stimulusIndex += 1) {
    const stimulus = scenario.stimuli[stimulusIndex]!;
    if (stimulus.kind === 'welcome') {
      if (generation !== undefined && stimulus.generation <= generation) {
        fail('invalid_order', `${scenario.id} welcome generations are not increasing`);
      }
      generation = stimulus.generation;
      lastTransaction = 1;
      queued = undefined;
      startTransaction({
        transaction: 1,
        revisions: cloneRevisions(desiredRevisions),
        nextDeclaration: 0,
        handedOff: false,
        promises: reconnectPromises,
      }, stimulusIndex);
      reconnectPromises = [];
    } else if (stimulus.kind === 'declaration_update') {
      if (generation === undefined
        || stimulus.transaction <= lastTransaction) {
        fail('invalid_order', `${scenario.id} starts an invalid declaration transaction`);
      }
      const revisions = validateRevisionUpdate(stimulus);
      desiredRevisions = cloneRevisions(revisions);
      lastTransaction = stimulus.transaction;
      const next: TransactionState = {
        transaction: stimulus.transaction,
        revisions,
        nextDeclaration: 0,
        handedOff: false,
        promises: promisesFor(stimulus),
      };
      if (current?.handedOff === true) {
        if (queued !== undefined) {
          settlePromises(queued.promises, stimulusIndex, 'rejected', 'superseded');
        }
        queued = next;
      } else {
        if (current !== undefined) {
          settlePromises(current.promises, stimulusIndex, 'rejected', 'superseded');
        }
        startTransaction(next, stimulusIndex);
      }
    } else if (stimulus.kind === 'declaration_handoff') {
      if (current === undefined
        || current.transaction !== stimulus.transaction
        || current.nextDeclaration !== DECLARATION_ORDER.length - 1
        || current.handedOff) {
        fail('invalid_order', `${scenario.id} hands off declarations before the final frame`);
      }
      current.handedOff = true;
    } else if (stimulus.kind === 'declaration_ack') {
      if (current === undefined || generation === undefined
        || stimulus.transaction !== current.transaction
        || stimulus.domain !== DECLARATION_ORDER[current.nextDeclaration]
        || (stimulus.domain === 'functions' && !current.handedOff)) {
        fail('invalid_order', `${scenario.id} acknowledges declarations outside barrier order`);
      }
      declarations.push({
        domain: stimulus.domain,
        generation,
        transaction: current.transaction,
      });
      current.nextDeclaration += 1;
      if (current.nextDeclaration === DECLARATION_ORDER.length) {
        activeRevisions = cloneRevisions(current.revisions);
        settlePromises(current.promises, stimulusIndex, 'activated');
        if (declarationFailures > 0) successfulActivationAfterFailure = true;
        if (queued !== undefined) {
          const next = queued;
          queued = undefined;
          startTransaction(next, stimulusIndex);
        } else {
          current = undefined;
        }
      }
    } else if (stimulus.kind === 'declaration_error') {
      if (current === undefined
        || stimulus.transaction !== current.transaction
        || stimulus.domain !== DECLARATION_ORDER[current.nextDeclaration]
        || (stimulus.domain === 'functions' && !current.handedOff)) {
        fail('invalid_order', `${scenario.id} rejects the wrong declaration slice`);
      }
      declarationFailures += 1;
      settlePromises(current.promises, stimulusIndex, 'rejected', stimulus.code);
      if (queued !== undefined) {
        settlePromises(queued.promises, stimulusIndex, 'rejected', stimulus.code);
      }
      if (activeRevisions !== undefined) {
        desiredRevisions = cloneRevisions(activeRevisions);
      }
      current = undefined;
      queued = undefined;
    } else if (stimulus.kind === 'declaration_probe') {
      visibility.push(activeRevisions === undefined
        ? 'none'
        : revisionsEqual(activeRevisions, desiredRevisions) ? 'desired' : 'previous');
    } else if (stimulus.kind === 'disconnect') {
      reconnectPromises = [
        ...reconnectPromises,
        ...(current?.promises ?? []),
        ...(queued?.promises ?? []),
      ];
      current = undefined;
      queued = undefined;
    } else if (stimulus.kind === 'stop') {
      const pending = [
        ...reconnectPromises,
        ...(current?.promises ?? []),
        ...(queued?.promises ?? []),
      ];
      settlePromises(pending, stimulusIndex, 'rejected', 'cancelled');
      reconnectPromises = [];
      current = undefined;
      queued = undefined;
    }
  }

  if (current !== undefined || queued !== undefined) {
    fail('missing_trace', `${scenario.id} leaves a declaration transaction unfinished`);
  }
  if (reconnectPromises.length > 0) {
    fail('missing_trace', `${scenario.id} leaves declaration promises unsettled`);
  }
  if (declarations.length !== scenario.expected.declarations.length
    || declarations.some((declaration, index) => {
      const observed = scenario.expected.declarations[index];
      return observed?.domain !== declaration.domain
        || observed.generation !== declaration.generation
        || observed.transaction !== declaration.transaction;
    })) {
    fail('missing_trace', `${scenario.id} declaration traces do not match acknowledgements`);
  }
  if (snapshots.length !== scenario.expected.declaration_snapshots.length
    || snapshots.some((snapshot, index) => {
      const observed = scenario.expected.declaration_snapshots[index];
      return observed?.generation !== snapshot.generation
        || observed.transaction !== snapshot.transaction
        || observed.stimulus_index !== snapshot.stimulus_index
        || !revisionsEqual(observed.revisions, snapshot.revisions);
    })) {
    fail('invalid_trace', `${scenario.id} declaration snapshots do not match desired revisions`);
  }
  if (visibility.length !== scenario.expected.declaration_visibility.length
    || visibility.some((entry, index) => scenario.expected.declaration_visibility[index] !== entry)) {
    fail('invalid_trace', `${scenario.id} exposes a partial declaration transaction`);
  }
  if (promiseSettlements.length !== scenario.expected.declaration_promises.length
    || promiseSettlements.some((settlement, index) => {
      const observed = scenario.expected.declaration_promises[index];
      return observed?.promise_id !== settlement.promise_id
        || observed.transaction !== settlement.transaction
        || observed.stimulus_index !== settlement.stimulus_index
        || observed.outcome !== settlement.outcome
        || observed.code !== settlement.code;
    })) {
    fail('invalid_trace', `${scenario.id} declaration promises do not settle with their transaction`);
  }
  if (scenario.coverage.includes('declaration_failure_rollback')) {
    if (declarationFailures === 0
      || !visibility.includes('previous')
      || !successfulActivationAfterFailure) {
      fail('missing_coverage', `${scenario.id} does not prove declaration failure rollback`);
    }
  }
}

function assertResourceCausality(scenario: CoordinatorContractScenario): void {
  const resources = scenario.expected.resources;
  if (resources.sockets > 1 || resources.socket_high_water > 1) {
    fail('resource_limit', `${scenario.id} transiently owns more than one managed socket`);
  }
  if (resources.sockets > resources.socket_high_water) {
    fail('invalid_trace', `${scenario.id} final sockets exceed their high-water mark`);
  }
  if (scenario.stimuli.some(({ kind }) => kind === 'welcome')
    && resources.socket_high_water !== 1) {
    fail('missing_trace', `${scenario.id} reaches welcome without one managed socket`);
  }
  const starts = scenario.stimuli.some(({ kind }) => kind === 'start');
  if (scenario.setup.mode === 'sdk' && !starts
    && (resources.sockets !== 0 || resources.socket_high_water !== 0)) {
    fail('resource_leak', `${scenario.id} creates a socket before start`);
  }
  if (scenario.coverage.includes('inert_construction')
    && (resources.sockets !== 0
      || resources.socket_high_water !== 0
      || resources.timers !== 0
      || resources.listeners !== 0
      || resources.iterators !== 0
      || scenario.expected.access_reasons.length !== 0)) {
    fail('resource_leak', `${scenario.id} construction is not inert`);
  }
  if (scenario.expected.statuses.includes('stopped')
    && (resources.sockets !== 0
      || resources.timers !== 0
      || resources.listeners !== 0
      || resources.iterators !== 0)) {
    fail('resource_leak', `${scenario.id} retains owned resources after stop`);
  }
}

function assertCausalContract(scenario: CoordinatorContractScenario): void {
  assertLifecycleCausality(scenario);
  assertOperationCausality(scenario);
  assertErrorCausality(scenario);
  assertPresenceCausality(scenario);
  assertEffectAndPublicationCausality(scenario);
  assertDeclarationCausality(scenario);
  assertResourceCausality(scenario);
}

function validateScenario(value: unknown, label: string): CoordinatorContractScenario {
  const root = exactObject(value, ['id', 'description', 'coverage', 'setup', 'stimuli', 'expected'], [], label);
  const setupRecord = exactObject(root.setup, ['mode', 'desired_declarations'], [], `${label}.setup`);
  const scenario: CoordinatorContractScenario = {
    id: contractId(root.id, `${label}.id`),
    description: boundedString(root.description, `${label}.description`),
    coverage: uniqueStrings(root.coverage, CONTRACT_COVERAGE, `${label}.coverage`),
    setup: {
      mode: enumValue(setupRecord.mode, ['sdk', 'observe', 'shadow_state', 'recorded_action'] as const, `${label}.setup.mode`),
      desired_declarations: uniqueStrings(setupRecord.desired_declarations, DECLARATION_ORDER, `${label}.setup.desired_declarations`),
    },
    stimuli: denseArray(root.stimuli, CONTRACT_LIMITS.stimuli, `${label}.stimuli`)
      .map((entry, index) => validateStimulus(entry, `${label}.stimuli[${index}]`)),
    expected: validateObservation(root.expected, `${label}.expected`),
  };

  assertCausalContract(scenario);
  if (scenario.setup.mode !== 'sdk') {
    if (scenario.expected.effects.some(({ destination }) => destination === 'live')) {
      fail('unsafe_shadow', `${scenario.id} routes a non-live effect to a live sink`);
    }
  }
  if (scenario.setup.mode === 'observe' && scenario.expected.resources.sockets !== 0) {
    fail('unsafe_shadow', `${scenario.id} observe mode owns a network socket`);
  }
  for (const effect of scenario.expected.effects) {
    if (effect.effect === 'unclassified' && effect.destination !== 'rejected') {
      fail('unsafe_shadow', `${scenario.id} does not reject an unclassified effect`);
    }
  }
  assertDeclarationOrder(scenario);
  return scenario;
}

export function validateCoordinatorContractCorpus(value: unknown): CoordinatorContractCorpus {
  assertAggregateBudget(
    value,
    'corpus',
    CONTRACT_LIMITS.corpusValues,
    CONTRACT_LIMITS.corpusStringBytes,
  );
  const root = exactObject(value, ['schema', 'fixture_version', 'required_coverage', 'scenarios'], [], 'corpus');
  if (root.schema !== CONTRACT_CORPUS_SCHEMA) fail('invalid_schema', 'corpus.schema is not supported');
  if (root.fixture_version !== 1) fail('invalid_schema', 'corpus.fixture_version is not supported');
  const requiredCoverage = uniqueStrings(root.required_coverage, CONTRACT_COVERAGE, 'corpus.required_coverage');
  const scenarios = denseArray(root.scenarios, CONTRACT_LIMITS.scenarios, 'corpus.scenarios')
    .map((scenario, index) => validateScenario(scenario, `corpus.scenarios[${index}]`));
  const ids = scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) fail('duplicate', 'corpus contains duplicate scenario IDs');
  const covered = new Set(scenarios.flatMap(({ coverage }) => coverage));
  for (const coverage of requiredCoverage) {
    if (!covered.has(coverage)) fail('missing_coverage', `corpus does not cover ${coverage}`);
  }
  return {
    schema: CONTRACT_CORPUS_SCHEMA,
    fixture_version: 1,
    required_coverage: requiredCoverage,
    scenarios,
  };
}

export function validateContractObservation(
  value: unknown,
  label = 'observation',
): ContractObservation {
  assertAggregateBudget(
    value,
    label,
    CONTRACT_LIMITS.observationValues,
    CONTRACT_LIMITS.observationStringBytes,
  );
  return validateObservation(value, label);
}
