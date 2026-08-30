export const MANIFEST_SCHEMA = 'miakapp.synthetic-home-manifest/1' as const;
export const HOME_SCHEMA = 'miakapp.synthetic-home/1' as const;
export const SCENARIOS_SCHEMA = 'miakapp.synthetic-home-scenarios/1' as const;

export const FIXTURE_LIMITS = Object.freeze({
  actors: 16,
  groups: 16,
  zones: 16,
  devices: 64,
  statePaths: 256,
  actions: 64,
  events: 64,
  scenarios: 64,
  stimuli: 16,
  effects: 64,
  recordEntries: 256,
  arrayItems: 256,
  jsonDepth: 16,
  jsonValues: 4_096,
  stringBytes: 1_024,
  descriptionBytes: 2_048,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTER = /\p{Cc}/u;
const SYNTHETIC_ID = /^syn_[a-z][a-z0-9_]{0,62}$/;
const RESOURCE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,15}$/;
const STATE_PATH = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,15}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UTF8 = new TextEncoder();

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ValueType = 'boolean' | 'number' | 'string' | 'object';
export type Persistence = 'ephemeral' | 'persisted';
export type ActorRole = 'owner' | 'resident' | 'guest';
export type ConnectionState = 'connected' | 'disconnected';
export type LifecycleSignal = 'ready' | 'disconnect' | 'reconnect' | 'no_coordinator';
export type CoverageClass =
  | 'bootstrap'
  | 'persisted_context'
  | 'sensor_automation'
  | 'authorization'
  | 'concurrent_action'
  | 'climate_control'
  | 'energy_schedule'
  | 'notification'
  | 'reconnect'
  | 'outcome_unknown';

export interface SyntheticHomeManifest {
  schema: typeof MANIFEST_SCHEMA;
  fixture_version: 1;
  corpus_id: string;
  seed: number;
  clock: {
    start: string;
    timezone: 'UTC';
  };
  provenance: {
    kind: 'hand_authored_synthetic';
    derived_from_export: false;
    contains_production_data: false;
    human_review_required: true;
  };
  files: {
    home: 'home.json';
    scenarios: 'scenarios.json';
  };
  required_coverage: CoverageClass[];
}

export interface ActorDeclaration {
  id: string;
  role: ActorRole;
  groups: string[];
  notifications_enabled: boolean;
}

export interface GroupDeclaration {
  id: string;
}

export interface ZoneDeclaration {
  id: string;
}

export interface DeviceDeclaration {
  id: string;
  zone_id: string;
  kind: string;
  capabilities: string[];
}

export interface StatePathDeclaration {
  path: string;
  value_type: ValueType;
  persistence: Persistence;
  writable: boolean;
}

export interface ActionDeclaration {
  id: string;
  type: 'click' | 'input';
  element_id: string;
  name: string;
  allowed_groups: string[];
  idempotency: 'idempotent' | 'non_idempotent';
  value_type?: ValueType;
}

export interface EventDeclaration {
  name: string;
  value_type: ValueType;
}

export interface FixtureContext {
  global: Record<string, JsonValue>;
  flows: Record<string, Record<string, JsonValue>>;
}

export interface SyntheticHome {
  schema: typeof HOME_SCHEMA;
  home_id: string;
  actors: ActorDeclaration[];
  groups: GroupDeclaration[];
  zones: ZoneDeclaration[];
  devices: DeviceDeclaration[];
  state_paths: StatePathDeclaration[];
  actions: ActionDeclaration[];
  events: EventDeclaration[];
  notification_contract: {
    required_fields: ['title', 'body'];
    optional_fields: ['tag', 'image'];
    audience: 'group_filtered';
    delivery: 'intent_only';
  };
  lifecycle_signals: LifecycleSignal[];
  initial_state: Record<string, JsonValue>;
  initial_context: FixtureContext;
}

export interface ScenarioSetup {
  connection: ConnectionState;
  state: Record<string, JsonValue>;
  context: FixtureContext;
}

export interface EventStimulus {
  kind: 'event';
  name: string;
  value: JsonValue;
}

export interface ActionStimulus {
  kind: 'action';
  operation_id: string;
  actor_id: string;
  action_id: string;
  type: 'click' | 'input';
  element_id: string;
  name: string;
  value?: JsonValue;
}

export interface LifecycleStimulus {
  kind: 'lifecycle';
  signal: LifecycleSignal;
}

export interface TimerStimulus {
  kind: 'timer';
  name: string;
  at: string;
}

export type ScenarioStimulus =
  | EventStimulus
  | ActionStimulus
  | LifecycleStimulus
  | TimerStimulus;

export interface RecordedCommand {
  target_id: string;
  name: string;
  value: JsonValue;
  cause:
    | { kind: 'operation'; operation_id: string }
    | { kind: 'stimulus'; stimulus_index: number };
}

export interface NotificationIntent {
  title: string;
  body: string;
  tag?: string;
  image?: string;
  audience: {
    groups: string[];
    actors: string[];
  };
}

export interface LifecycleObservation {
  signal: LifecycleSignal;
  reason?: string;
}

export interface OperationObservation {
  operation_id: string;
  status: 'accepted' | 'applied' | 'denied' | 'outcome_unknown';
  reason?: string;
}

export interface ScenarioObservation {
  state_patch: Record<string, JsonValue>;
  context_patch: FixtureContext;
  recorded_commands: RecordedCommand[];
  notification_intents: NotificationIntent[];
  lifecycle: LifecycleObservation[];
  operations: OperationObservation[];
  unchanged_paths: string[];
}

export interface ReplayObservation {
  state: Record<string, JsonValue>;
  context: FixtureContext;
  recorded_commands: RecordedCommand[];
  notification_intents: NotificationIntent[];
  lifecycle: LifecycleObservation[];
  operations: OperationObservation[];
}

export interface SyntheticScenario {
  id: string;
  description: string;
  coverage: CoverageClass[];
  setup: ScenarioSetup;
  stimuli: ScenarioStimulus[];
  expected: ScenarioObservation;
}

export interface SyntheticScenarioCorpus {
  schema: typeof SCENARIOS_SCHEMA;
  home_id: string;
  scenarios: SyntheticScenario[];
}

export class FixtureViolation extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FixtureViolation';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FixtureViolation(code, message);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownKeys(record: Record<string, unknown>, label: string): string[] {
  const keys = Object.keys(record);
  if (keys.length > FIXTURE_LIMITS.recordEntries) {
    fail('limit_exceeded', `${label} has too many entries`);
  }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) fail('forbidden_key', `${label} contains forbidden key ${key}`);
  }
  return keys;
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'object',
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('invalid_type', `${label} must be a plain record`);
  const keys = ownKeys(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('missing_field', `${label}.${key} is required`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) fail('unknown_field', `${label}.${key} is not allowed`);
  }
  return value;
}

function denseArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) fail('invalid_type', `${label} must be an array`);
  if (value.length > maximum) fail('limit_exceeded', `${label} has too many entries`);
  const keys = Object.keys(value);
  if (keys.length !== value.length) fail('invalid_type', `${label} must be a dense array`);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== String(index)) fail('invalid_type', `${label} must be a dense array`);
  }
  return value;
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_string', `${label} must be a non-empty string`);
  }
  if (CONTROL_CHARACTER.test(value)) fail('invalid_string', `${label} contains a control character`);
  if (UTF8.encode(value).byteLength > maximum) {
    fail('limit_exceeded', `${label} exceeds ${maximum} UTF-8 bytes`);
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

function uniqueStrings(
  value: unknown,
  maximum: number,
  label: string,
  validate: (entry: unknown, label: string) => string,
): string[] {
  const entries = denseArray(value, maximum, label);
  const result = entries.map((entry, index) => validate(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail('duplicate', `${label} contains duplicates`);
  return result;
}

export function validateSyntheticId(value: unknown, label = 'id'): string {
  const id = boundedString(value, 64, label);
  if (!SYNTHETIC_ID.test(id)) fail('invalid_identifier', `${label} must use the syn_ namespace`);
  return id;
}

export function validateResourceName(value: unknown, label = 'resource'): string {
  const resource = boundedString(value, 256, label);
  if (!RESOURCE_NAME.test(resource)) fail('invalid_identifier', `${label} is not a resource name`);
  return resource;
}

export function validateStatePath(value: unknown, label = 'state path'): string {
  const path = boundedString(value, 256, label);
  if (!STATE_PATH.test(path)) fail('invalid_identifier', `${label} is not a dotted state path`);
  return path;
}

export function validateUtcTimestamp(value: unknown, label = 'timestamp'): string {
  const timestamp = boundedString(value, 64, label);
  const milliseconds = Date.parse(timestamp);
  const canonical = timestamp.includes('.') ? timestamp : timestamp.replace('Z', '.000Z');
  if (!UTC_TIMESTAMP.test(timestamp)
    || !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== canonical) {
    fail('invalid_timestamp', `${label} must be an RFC 3339 UTC timestamp`);
  }
  return timestamp;
}

export function validateJsonValue(value: unknown, label = 'value'): asserts value is JsonValue {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; label: string }> = [
    { value, depth: 0, label },
  ];
  let values = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    values += 1;
    if (values > FIXTURE_LIMITS.jsonValues) fail('limit_exceeded', `${label} has too many values`);
    if (current.depth > FIXTURE_LIMITS.jsonDepth) fail('limit_exceeded', `${label} is too deep`);

    const item = current.value;
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)
        || Object.is(item, -0)
        || (Number.isInteger(item) && !Number.isSafeInteger(item))) {
        fail('invalid_number', `${current.label} must be a finite canonical JSON number`);
      }
      continue;
    }
    if (typeof item === 'string') {
      if (CONTROL_CHARACTER.test(item)) {
        fail('invalid_string', `${current.label} contains a control character`);
      }
      if (UTF8.encode(item).byteLength > FIXTURE_LIMITS.stringBytes) {
        fail('limit_exceeded', `${current.label} is too large`);
      }
      continue;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) fail('invalid_value', `${current.label} contains a cycle`);
      seen.add(item);
      const entries = denseArray(item, FIXTURE_LIMITS.arrayItems, current.label);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: entries[index],
          depth: current.depth + 1,
          label: `${current.label}[${index}]`,
        });
      }
      continue;
    }
    if (isPlainRecord(item)) {
      if (seen.has(item)) fail('invalid_value', `${current.label} contains a cycle`);
      seen.add(item);
      for (const key of ownKeys(item, current.label)) {
        boundedString(key, 128, `${current.label} key`);
        stack.push({
          value: item[key],
          depth: current.depth + 1,
          label: `${current.label}.${key}`,
        });
      }
      continue;
    }
    fail('invalid_type', `${current.label} is not JSON-compatible`);
  }
}

export function valueMatchesType(value: JsonValue, type: ValueType): boolean {
  if (type === 'object') return isPlainRecord(value);
  return typeof value === type;
}

function validateValueType(value: unknown, label: string): ValueType {
  return enumValue(value, ['boolean', 'number', 'string', 'object'], label);
}

function validateCoverageList(value: unknown, label: string): CoverageClass[] {
  return uniqueStrings(value, 16, label, (entry, entryLabel) => enumValue(entry, [
    'bootstrap',
    'persisted_context',
    'sensor_automation',
    'authorization',
    'concurrent_action',
    'climate_control',
    'energy_schedule',
    'notification',
    'reconnect',
    'outcome_unknown',
  ], entryLabel)) as CoverageClass[];
}

function validateStateRecord(value: unknown, label: string): Record<string, JsonValue> {
  if (!isPlainRecord(value)) fail('invalid_type', `${label} must be a plain record`);
  for (const key of ownKeys(value, label)) {
    validateStatePath(key, `${label} key`);
    validateJsonValue(value[key], `${label}.${key}`);
  }
  return value as Record<string, JsonValue>;
}

function validateContextRecord(value: unknown, label: string): Record<string, JsonValue> {
  if (!isPlainRecord(value)) fail('invalid_type', `${label} must be a plain record`);
  for (const key of ownKeys(value, label)) {
    validateResourceName(key, `${label} key`);
    validateJsonValue(value[key], `${label}.${key}`);
  }
  return value as Record<string, JsonValue>;
}

function validateContext(value: unknown, label: string): FixtureContext {
  const record = exactObject(value, ['global', 'flows'], [], label);
  const global = validateContextRecord(record.global, `${label}.global`);
  if (!isPlainRecord(record.flows)) fail('invalid_type', `${label}.flows must be a plain record`);
  const flows: Record<string, Record<string, JsonValue>> = {};
  for (const key of ownKeys(record.flows, `${label}.flows`)) {
    validateSyntheticId(key, `${label}.flows key`);
    flows[key] = validateContextRecord(record.flows[key], `${label}.flows.${key}`);
  }
  return { global, flows };
}

function validateActor(value: unknown, label: string): ActorDeclaration {
  const record = exactObject(value, ['id', 'role', 'groups', 'notifications_enabled'], [], label);
  validateSyntheticId(record.id, `${label}.id`);
  enumValue(record.role, ['owner', 'resident', 'guest'], `${label}.role`);
  uniqueStrings(record.groups, FIXTURE_LIMITS.groups, `${label}.groups`, validateSyntheticId);
  if (typeof record.notifications_enabled !== 'boolean') {
    fail('invalid_type', `${label}.notifications_enabled must be boolean`);
  }
  return record as unknown as ActorDeclaration;
}

function validateGroup(value: unknown, label: string): GroupDeclaration {
  const record = exactObject(value, ['id'], [], label);
  validateSyntheticId(record.id, `${label}.id`);
  return record as unknown as GroupDeclaration;
}

function validateZone(value: unknown, label: string): ZoneDeclaration {
  const record = exactObject(value, ['id'], [], label);
  validateSyntheticId(record.id, `${label}.id`);
  return record as unknown as ZoneDeclaration;
}

function validateDevice(value: unknown, label: string): DeviceDeclaration {
  const record = exactObject(value, ['id', 'zone_id', 'kind', 'capabilities'], [], label);
  validateSyntheticId(record.id, `${label}.id`);
  validateSyntheticId(record.zone_id, `${label}.zone_id`);
  validateResourceName(record.kind, `${label}.kind`);
  const capabilities = uniqueStrings(
    record.capabilities,
    32,
    `${label}.capabilities`,
    validateResourceName,
  );
  if (capabilities.length === 0) fail('missing_field', `${label}.capabilities must not be empty`);
  return record as unknown as DeviceDeclaration;
}

function validateStateDeclaration(value: unknown, label: string): StatePathDeclaration {
  const record = exactObject(
    value,
    ['path', 'value_type', 'persistence', 'writable'],
    [],
    label,
  );
  validateStatePath(record.path, `${label}.path`);
  validateValueType(record.value_type, `${label}.value_type`);
  enumValue(record.persistence, ['ephemeral', 'persisted'], `${label}.persistence`);
  if (typeof record.writable !== 'boolean') fail('invalid_type', `${label}.writable must be boolean`);
  return record as unknown as StatePathDeclaration;
}

function validateAction(value: unknown, label: string): ActionDeclaration {
  const record = exactObject(
    value,
    ['id', 'type', 'element_id', 'name', 'allowed_groups', 'idempotency'],
    ['value_type'],
    label,
  );
  validateSyntheticId(record.id, `${label}.id`);
  const type = enumValue(record.type, ['click', 'input'], `${label}.type`);
  validateSyntheticId(record.element_id, `${label}.element_id`);
  validateResourceName(record.name, `${label}.name`);
  uniqueStrings(
    record.allowed_groups,
    FIXTURE_LIMITS.groups,
    `${label}.allowed_groups`,
    validateSyntheticId,
  );
  enumValue(record.idempotency, ['idempotent', 'non_idempotent'], `${label}.idempotency`);
  if (type === 'input') {
    if (record.value_type === undefined) fail('missing_field', `${label}.value_type is required`);
    validateValueType(record.value_type, `${label}.value_type`);
  } else if (record.value_type !== undefined) {
    fail('unknown_field', `${label}.value_type is not allowed for click actions`);
  }
  return record as unknown as ActionDeclaration;
}

function validateEvent(value: unknown, label: string): EventDeclaration {
  const record = exactObject(value, ['name', 'value_type'], [], label);
  validateResourceName(record.name, `${label}.name`);
  validateValueType(record.value_type, `${label}.value_type`);
  return record as unknown as EventDeclaration;
}

function validateUniqueObjects<T extends object, K extends Extract<keyof T, string>>(
  value: unknown,
  maximum: number,
  label: string,
  validate: (entry: unknown, label: string) => T,
  key: K,
): void {
  const entries = denseArray(value, maximum, label);
  const identifiers = entries.map((entry, index) => {
    const result = validate(entry, `${label}[${index}]`);
    return result[key];
  });
  if (new Set(identifiers).size !== identifiers.length) {
    fail('duplicate', `${label} contains duplicate ${key} values`);
  }
}

export function validateManifest(value: unknown): SyntheticHomeManifest {
  const record = exactObject(value, [
    'schema',
    'fixture_version',
    'corpus_id',
    'seed',
    'clock',
    'provenance',
    'files',
    'required_coverage',
  ], [], 'manifest');
  if (record.schema !== MANIFEST_SCHEMA) fail('unsupported_schema', 'manifest.schema is unsupported');
  if (record.fixture_version !== 1) fail('unsupported_schema', 'manifest.fixture_version is unsupported');
  validateSyntheticId(record.corpus_id, 'manifest.corpus_id');
  if (!Number.isSafeInteger(record.seed)
    || Object.is(record.seed, -0)
    || (record.seed as number) < 0) {
    fail('invalid_integer', 'manifest.seed must be a non-negative safe integer');
  }

  const clock = exactObject(record.clock, ['start', 'timezone'], [], 'manifest.clock');
  validateUtcTimestamp(clock.start, 'manifest.clock.start');
  if (clock.timezone !== 'UTC') fail('invalid_value', 'manifest.clock.timezone must be UTC');

  const provenance = exactObject(record.provenance, [
    'kind',
    'derived_from_export',
    'contains_production_data',
    'human_review_required',
  ], [], 'manifest.provenance');
  if (provenance.kind !== 'hand_authored_synthetic'
    || provenance.derived_from_export !== false
    || provenance.contains_production_data !== false
    || provenance.human_review_required !== true) {
    fail('invalid_provenance', 'manifest provenance must declare a hand-authored public fixture');
  }

  const files = exactObject(record.files, ['home', 'scenarios'], [], 'manifest.files');
  if (files.home !== 'home.json' || files.scenarios !== 'scenarios.json') {
    fail('invalid_value', 'manifest files must use the v1 canonical names');
  }
  const coverage = validateCoverageList(record.required_coverage, 'manifest.required_coverage');
  if (coverage.length === 0) fail('missing_field', 'manifest.required_coverage must not be empty');
  return record as unknown as SyntheticHomeManifest;
}

export function validateHome(value: unknown): SyntheticHome {
  const record = exactObject(value, [
    'schema',
    'home_id',
    'actors',
    'groups',
    'zones',
    'devices',
    'state_paths',
    'actions',
    'events',
    'notification_contract',
    'lifecycle_signals',
    'initial_state',
    'initial_context',
  ], [], 'home');
  if (record.schema !== HOME_SCHEMA) fail('unsupported_schema', 'home.schema is unsupported');
  validateSyntheticId(record.home_id, 'home.home_id');
  validateUniqueObjects(record.actors, FIXTURE_LIMITS.actors, 'home.actors', validateActor, 'id');
  validateUniqueObjects(record.groups, FIXTURE_LIMITS.groups, 'home.groups', validateGroup, 'id');
  validateUniqueObjects(record.zones, FIXTURE_LIMITS.zones, 'home.zones', validateZone, 'id');
  validateUniqueObjects(record.devices, FIXTURE_LIMITS.devices, 'home.devices', validateDevice, 'id');
  validateUniqueObjects(
    record.state_paths,
    FIXTURE_LIMITS.statePaths,
    'home.state_paths',
    validateStateDeclaration,
    'path',
  );
  validateUniqueObjects(record.actions, FIXTURE_LIMITS.actions, 'home.actions', validateAction, 'id');
  const actionElements = (record.actions as ActionDeclaration[]).map(({ element_id: elementId }) => (
    elementId
  ));
  if (new Set(actionElements).size !== actionElements.length) {
    fail('duplicate', 'home.actions contains duplicate element_id values');
  }
  validateUniqueObjects(record.events, FIXTURE_LIMITS.events, 'home.events', validateEvent, 'name');

  const notification = exactObject(record.notification_contract, [
    'required_fields',
    'optional_fields',
    'audience',
    'delivery',
  ], [], 'home.notification_contract');
  const requiredFields = denseArray(
    notification.required_fields,
    2,
    'home.notification_contract.required_fields',
  );
  const optionalFields = denseArray(
    notification.optional_fields,
    2,
    'home.notification_contract.optional_fields',
  );
  if (requiredFields.length !== 2 || requiredFields[0] !== 'title' || requiredFields[1] !== 'body') {
    fail('invalid_value', 'notification required fields must be title and body');
  }
  if (optionalFields.length !== 2 || optionalFields[0] !== 'tag' || optionalFields[1] !== 'image') {
    fail('invalid_value', 'notification optional fields must be tag and image');
  }
  if (notification.audience !== 'group_filtered' || notification.delivery !== 'intent_only') {
    fail('invalid_value', 'notification contract must remain an intent-only group-filtered contract');
  }

  uniqueStrings(record.lifecycle_signals, 8, 'home.lifecycle_signals', (entry, label) => (
    enumValue(entry, ['ready', 'disconnect', 'reconnect', 'no_coordinator'], label)
  ));
  validateStateRecord(record.initial_state, 'home.initial_state');
  validateContext(record.initial_context, 'home.initial_context');
  return record as unknown as SyntheticHome;
}

function validateStimulus(value: unknown, label: string): ScenarioStimulus {
  if (!isPlainRecord(value)) fail('invalid_type', `${label} must be a plain record`);
  const kind = enumValue(value.kind, ['event', 'action', 'lifecycle', 'timer'], `${label}.kind`);

  if (kind === 'event') {
    const record = exactObject(value, ['kind', 'name', 'value'], [], label);
    validateResourceName(record.name, `${label}.name`);
    validateJsonValue(record.value, `${label}.value`);
    return record as unknown as EventStimulus;
  }
  if (kind === 'action') {
    const record = exactObject(value, [
      'kind',
      'operation_id',
      'actor_id',
      'action_id',
      'type',
      'element_id',
      'name',
    ], ['value'], label);
    validateSyntheticId(record.operation_id, `${label}.operation_id`);
    validateSyntheticId(record.actor_id, `${label}.actor_id`);
    validateSyntheticId(record.action_id, `${label}.action_id`);
    const actionType = enumValue(record.type, ['click', 'input'], `${label}.type`);
    validateSyntheticId(record.element_id, `${label}.element_id`);
    validateResourceName(record.name, `${label}.name`);
    if (actionType === 'input') {
      if (!Object.hasOwn(record, 'value')) fail('missing_field', `${label}.value is required`);
      validateJsonValue(record.value, `${label}.value`);
    } else if (Object.hasOwn(record, 'value')) {
      fail('unknown_field', `${label}.value is not allowed for click actions`);
    }
    return record as unknown as ActionStimulus;
  }
  if (kind === 'lifecycle') {
    const record = exactObject(value, ['kind', 'signal'], [], label);
    enumValue(record.signal, ['ready', 'disconnect', 'reconnect', 'no_coordinator'], `${label}.signal`);
    return record as unknown as LifecycleStimulus;
  }
  const record = exactObject(value, ['kind', 'name', 'at'], [], label);
  validateResourceName(record.name, `${label}.name`);
  validateUtcTimestamp(record.at, `${label}.at`);
  return record as unknown as TimerStimulus;
}

function validateCommand(value: unknown, label: string): RecordedCommand {
  const record = exactObject(value, ['target_id', 'name', 'value', 'cause'], [], label);
  validateSyntheticId(record.target_id, `${label}.target_id`);
  validateResourceName(record.name, `${label}.name`);
  validateJsonValue(record.value, `${label}.value`);
  if (!isPlainRecord(record.cause)) fail('invalid_type', `${label}.cause must be a plain record`);
  const causeKind = enumValue(
    record.cause.kind,
    ['operation', 'stimulus'],
    `${label}.cause.kind`,
  );
  if (causeKind === 'operation') {
    const cause = exactObject(
      record.cause,
      ['kind', 'operation_id'],
      [],
      `${label}.cause`,
    );
    validateSyntheticId(cause.operation_id, `${label}.cause.operation_id`);
  } else {
    const cause = exactObject(
      record.cause,
      ['kind', 'stimulus_index'],
      [],
      `${label}.cause`,
    );
    if (!Number.isSafeInteger(cause.stimulus_index)
      || (cause.stimulus_index as number) < 0
      || (cause.stimulus_index as number) >= FIXTURE_LIMITS.stimuli) {
      fail('invalid_integer', `${label}.cause.stimulus_index is outside the stimulus limit`);
    }
  }
  return record as unknown as RecordedCommand;
}

function validateNotification(value: unknown, label: string): NotificationIntent {
  const record = exactObject(value, ['title', 'body', 'audience'], ['tag', 'image'], label);
  boundedString(record.title, FIXTURE_LIMITS.stringBytes, `${label}.title`);
  boundedString(record.body, FIXTURE_LIMITS.stringBytes, `${label}.body`);
  if (record.tag !== undefined) boundedString(record.tag, 128, `${label}.tag`);
  if (record.image !== undefined) boundedString(record.image, 512, `${label}.image`);
  const audience = exactObject(record.audience, ['groups', 'actors'], [], `${label}.audience`);
  uniqueStrings(audience.groups, FIXTURE_LIMITS.groups, `${label}.audience.groups`, validateSyntheticId);
  uniqueStrings(audience.actors, FIXTURE_LIMITS.actors, `${label}.audience.actors`, validateSyntheticId);
  return record as unknown as NotificationIntent;
}

function validateLifecycleObservation(value: unknown, label: string): LifecycleObservation {
  const record = exactObject(value, ['signal'], ['reason'], label);
  enumValue(record.signal, ['ready', 'disconnect', 'reconnect', 'no_coordinator'], `${label}.signal`);
  if (record.reason !== undefined) boundedString(record.reason, 256, `${label}.reason`);
  return record as unknown as LifecycleObservation;
}

function validateOperation(value: unknown, label: string): OperationObservation {
  const record = exactObject(value, ['operation_id', 'status'], ['reason'], label);
  validateSyntheticId(record.operation_id, `${label}.operation_id`);
  const status = enumValue(
    record.status,
    ['accepted', 'applied', 'denied', 'outcome_unknown'],
    `${label}.status`,
  );
  if (status === 'denied' || status === 'outcome_unknown') {
    if (record.reason === undefined) fail('missing_field', `${label}.reason is required`);
    boundedString(record.reason, 256, `${label}.reason`);
  } else if (record.reason !== undefined) {
    fail('unknown_field', `${label}.reason is not allowed for ${status}`);
  }
  return record as unknown as OperationObservation;
}

export function validateObservation(value: unknown, label = 'observation'): ScenarioObservation {
  const record = exactObject(value, [
    'state_patch',
    'context_patch',
    'recorded_commands',
    'notification_intents',
    'lifecycle',
    'operations',
    'unchanged_paths',
  ], [], label);
  validateStateRecord(record.state_patch, `${label}.state_patch`);
  validateContext(record.context_patch, `${label}.context_patch`);
  denseArray(record.recorded_commands, FIXTURE_LIMITS.effects, `${label}.recorded_commands`)
    .forEach((entry, index) => validateCommand(entry, `${label}.recorded_commands[${index}]`));
  denseArray(record.notification_intents, FIXTURE_LIMITS.effects, `${label}.notification_intents`)
    .forEach((entry, index) => validateNotification(entry, `${label}.notification_intents[${index}]`));
  denseArray(record.lifecycle, FIXTURE_LIMITS.effects, `${label}.lifecycle`)
    .forEach((entry, index) => validateLifecycleObservation(entry, `${label}.lifecycle[${index}]`));
  denseArray(record.operations, FIXTURE_LIMITS.effects, `${label}.operations`)
    .forEach((entry, index) => validateOperation(entry, `${label}.operations[${index}]`));
  uniqueStrings(
    record.unchanged_paths,
    FIXTURE_LIMITS.statePaths,
    `${label}.unchanged_paths`,
    validateStatePath,
  );
  return record as unknown as ScenarioObservation;
}

export function validateReplayObservation(
  value: unknown,
  label = 'replay observation',
): ReplayObservation {
  const record = exactObject(value, [
    'state',
    'context',
    'recorded_commands',
    'notification_intents',
    'lifecycle',
    'operations',
  ], [], label);
  validateStateRecord(record.state, `${label}.state`);
  validateContext(record.context, `${label}.context`);
  denseArray(record.recorded_commands, FIXTURE_LIMITS.effects, `${label}.recorded_commands`)
    .forEach((entry, index) => validateCommand(entry, `${label}.recorded_commands[${index}]`));
  denseArray(record.notification_intents, FIXTURE_LIMITS.effects, `${label}.notification_intents`)
    .forEach((entry, index) => validateNotification(entry, `${label}.notification_intents[${index}]`));
  denseArray(record.lifecycle, FIXTURE_LIMITS.effects, `${label}.lifecycle`)
    .forEach((entry, index) => validateLifecycleObservation(entry, `${label}.lifecycle[${index}]`));
  denseArray(record.operations, FIXTURE_LIMITS.effects, `${label}.operations`)
    .forEach((entry, index) => validateOperation(entry, `${label}.operations[${index}]`));
  return record as unknown as ReplayObservation;
}

function validateScenario(value: unknown, label: string): SyntheticScenario {
  const record = exactObject(
    value,
    ['id', 'description', 'coverage', 'setup', 'stimuli', 'expected'],
    [],
    label,
  );
  validateSyntheticId(record.id, `${label}.id`);
  boundedString(record.description, FIXTURE_LIMITS.descriptionBytes, `${label}.description`);
  const coverage = validateCoverageList(record.coverage, `${label}.coverage`);
  if (coverage.length === 0) fail('missing_field', `${label}.coverage must not be empty`);

  const setup = exactObject(record.setup, ['connection', 'state', 'context'], [], `${label}.setup`);
  enumValue(setup.connection, ['connected', 'disconnected'], `${label}.setup.connection`);
  validateStateRecord(setup.state, `${label}.setup.state`);
  validateContext(setup.context, `${label}.setup.context`);

  const stimuli = denseArray(record.stimuli, FIXTURE_LIMITS.stimuli, `${label}.stimuli`);
  if (stimuli.length === 0) fail('missing_field', `${label}.stimuli must not be empty`);
  stimuli.forEach((entry, index) => validateStimulus(entry, `${label}.stimuli[${index}]`));
  validateObservation(record.expected, `${label}.expected`);
  return record as unknown as SyntheticScenario;
}

export function validateScenarioCorpus(value: unknown): SyntheticScenarioCorpus {
  const record = exactObject(value, ['schema', 'home_id', 'scenarios'], [], 'scenario corpus');
  if (record.schema !== SCENARIOS_SCHEMA) {
    fail('unsupported_schema', 'scenario corpus schema is unsupported');
  }
  validateSyntheticId(record.home_id, 'scenario corpus.home_id');
  const scenarios = denseArray(record.scenarios, FIXTURE_LIMITS.scenarios, 'scenario corpus.scenarios');
  if (scenarios.length === 0) fail('missing_field', 'scenario corpus.scenarios must not be empty');
  const identifiers = scenarios.map((entry, index) => (
    validateScenario(entry, `scenario corpus.scenarios[${index}]`).id
  ));
  if (new Set(identifiers).size !== identifiers.length) {
    fail('duplicate', 'scenario corpus contains duplicate scenario IDs');
  }
  return record as unknown as SyntheticScenarioCorpus;
}
