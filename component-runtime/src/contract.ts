export const POINTER_SCHEMA = 'miakapp.component-pointer/1' as const;
export const COMPONENT_ABI = 'miakapp.component/1' as const;
export const BROKER_PROTOCOL = 1 as const;

export const LIMITS = Object.freeze({
  artifactBytes: 2_097_152,
  envelopeBytes: 524_288,
  uiNodes: 1_024,
  uiDepth: 32,
  uiTextBytes: 262_144,
  textBytes: 8_192,
  inputBytes: 16_384,
  selectOptions: 100,
  structuredArrayItems: 4_096,
  structuredValues: 16_384,
  requirementEntries: 512,
  requirementListEntries: 256,
  outstandingCalls: 32,
  callCredit: 32,
  callDeadlineMs: 300_000,
  guestMessagesPerSecond: 120,
  rendersPerSecond: 30,
  workerBootMs: 3_000,
  firstRenderMs: 3_000,
  workerHeartbeatMs: 1_000,
  workerMissedHeartbeats: 3,
  heartbeatMs: 5_000,
  missedHeartbeats: 3,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTER = /\p{Cc}/u;
const NODE_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const INSTANCE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const UTF8 = new TextEncoder();

export type RequirementKind =
  | 'state_read'
  | 'event_subscribe'
  | 'event_publish'
  | 'call'
  | 'presentation';

export interface CapabilityRequirements {
  state_read: string[];
  event_subscribe: string[];
  event_publish: string[];
  call: string[];
  presentation: string[];
}

export interface ComponentPointerV1 {
  schema: typeof POINTER_SCHEMA;
  home_id: string;
  generation: number;
  release: string;
  abi: typeof COMPONENT_ABI;
  url: string;
  sha256: string;
  size: number;
  requires: CapabilityRequirements;
}

export type UiNodeType =
  | 'screen'
  | 'stack'
  | 'grid'
  | 'section'
  | 'text'
  | 'status'
  | 'button'
  | 'toggle'
  | 'input'
  | 'select'
  | 'progress'
  | 'media';

export interface UiNode {
  id: string;
  type: UiNodeType;
  props: Record<string, unknown>;
  children?: UiNode[];
}

export interface Envelope<T = unknown> {
  v: typeof BROKER_PROTOCOL;
  instance: string;
  epoch: number;
  seq: number;
  kind: string;
  payload: T;
}

export interface PointerValidationContext {
  expectedHomeId: string;
  minimumGeneration?: number;
  allowedArtifactOrigins: ReadonlySet<string>;
  allowedPathPrefixes?: readonly string[];
}

export interface UiValidationContext {
  mediaHandles?: ReadonlySet<string>;
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

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownKeys(value: Record<string, unknown>): string[] {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) fail('forbidden_key', `Forbidden key: ${key}`);
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
  const allowed = new Set([...required, ...optional]);
  const keys = ownKeys(value);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('missing_field', `${label}.${key} is required`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) fail('unknown_field', `${label}.${key} is not allowed`);
  }
  return value;
}

function denseArray(
  value: unknown,
  maximum: number,
  label: string,
  code = 'invalid_type',
): unknown[] {
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  if (value.length > maximum) fail(code, `${label} has too many entries`);
  const keys = Object.keys(value);
  if (keys.length !== value.length) fail(code, `${label} must be a dense canonical array`);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== String(index)) {
      fail(code, `${label} must not contain named or missing entries`);
    }
  }
  return value;
}

function utf8Bytes(value: string): number {
  return UTF8.encode(value).byteLength;
}

function boundedString(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_string', `${label} must be a non-empty string`);
  }
  if (CONTROL_CHARACTER.test(value)) fail('invalid_string', `${label} contains a control character`);
  if (utf8Bytes(value) > maxBytes) fail('string_too_large', `${label} exceeds ${maxBytes} UTF-8 bytes`);
  return value;
}

function optionalString(value: unknown, maxBytes: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, maxBytes, label);
}

function safePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail('invalid_integer', `${label} must be a positive safe integer`);
  }
  return value as number;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_number', `${label} must be finite`);
  }
  return value;
}

export function validateResourceName(value: unknown, label = 'resource'): string {
  const name = boundedString(value, 256, label);
  if (name.includes('*')) fail('invalid_resource', `${label} contains a wildcard`);
  if (name.startsWith('.') || name.endsWith('.') || name.includes('..')) {
    fail('invalid_resource', `${label} has an empty dotted segment`);
  }
  return name;
}

export function validateCapabilityPattern(value: unknown, label = 'capability'): string {
  const pattern = boundedString(value, 258, label);
  if (pattern.endsWith('.*')) {
    validateResourceName(pattern.slice(0, -2), label);
    return pattern;
  }
  return validateResourceName(pattern, label);
}

export function isCapabilityGranted(patterns: readonly string[], resource: string): boolean {
  validateResourceName(resource);
  return patterns.some((pattern) => (
    pattern === resource
    || (pattern.endsWith('.*') && resource.startsWith(`${pattern.slice(0, -2)}.`))
  ));
}

function validateRequirementList(value: unknown, label: string): string[] {
  const entries = denseArray(
    value,
    LIMITS.requirementListEntries,
    label,
    'invalid_requirements',
  );
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const normalized = validateCapabilityPattern(entry, `${label}[${index}]`);
    if (seen.has(normalized)) fail('invalid_requirements', `${label} contains a duplicate`);
    seen.add(normalized);
    return normalized;
  });
}

export function validateRequirements(value: unknown): CapabilityRequirements {
  const record = exactObject(value, [
    'state_read',
    'event_subscribe',
    'event_publish',
    'call',
    'presentation',
  ], [], 'requires');
  const presentation = validateRequirementList(record.presentation, 'requires.presentation');
  if (presentation.some((entry) => !entry.startsWith('media.') || entry.endsWith('.*'))) {
    fail('invalid_requirements', 'requires.presentation accepts exact media handles only in ABI 1');
  }
  const requirements: CapabilityRequirements = {
    state_read: validateRequirementList(record.state_read, 'requires.state_read'),
    event_subscribe: validateRequirementList(record.event_subscribe, 'requires.event_subscribe'),
    event_publish: validateRequirementList(record.event_publish, 'requires.event_publish'),
    call: validateRequirementList(record.call, 'requires.call'),
    presentation,
  };
  const count = Object.values(requirements).reduce((sum, list) => sum + list.length, 0);
  if (count > LIMITS.requirementEntries) {
    fail('invalid_requirements', 'requires contains too many total entries');
  }
  return requirements;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!SHA256_BASE64URL.test(value)) fail('pointer_invalid', 'sha256 must be unpadded base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '=';
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32) fail('pointer_invalid', 'sha256 must encode 32 bytes');
    return bytes;
  } catch (error) {
    if (error instanceof ContractViolation) throw error;
    return fail('pointer_invalid', 'sha256 is not valid base64url');
  }
}

function validateArtifactUrl(raw: unknown, context: PointerValidationContext): string {
  const value = boundedString(raw, 2_048, 'url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('pointer_invalid', 'url is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    fail('pointer_invalid', 'url must be credential-free HTTPS without a fragment');
  }
  if (!context.allowedArtifactOrigins.has(url.origin)) {
    fail('pointer_invalid', 'url origin is not allowed');
  }
  if (context.allowedPathPrefixes?.length
    && !context.allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    fail('pointer_invalid', 'url path is not allowed');
  }
  return url.href;
}

function validatePointerValue(
  value: unknown,
  context: PointerValidationContext,
): ComponentPointerV1 {
  const record = exactObject(value, [
    'schema',
    'home_id',
    'generation',
    'release',
    'abi',
    'url',
    'sha256',
    'size',
    'requires',
  ], [], 'pointer');

  if (record.schema !== POINTER_SCHEMA) fail('pointer_invalid', 'unsupported pointer schema');
  if (record.abi !== COMPONENT_ABI) fail('pointer_invalid', 'unsupported component ABI');
  const homeId = boundedString(record.home_id, 128, 'home_id');
  if (homeId !== context.expectedHomeId) fail('pointer_invalid', 'home_id does not match enrollment');
  const generation = safePositiveInteger(record.generation, 'generation');
  if (generation < (context.minimumGeneration ?? 0)) {
    fail('pointer_invalid', 'generation is below the accepted anti-rollback floor');
  }
  const release = boundedString(record.release, 64, 'release');
  const url = validateArtifactUrl(record.url, context);
  const sha256 = boundedString(record.sha256, 64, 'sha256');
  decodeBase64Url(sha256);
  const size = safePositiveInteger(record.size, 'size');
  if (size > LIMITS.artifactBytes) fail('artifact_too_large', 'artifact exceeds the ABI limit');

  return {
    schema: POINTER_SCHEMA,
    home_id: homeId,
    generation,
    release,
    abi: COMPONENT_ABI,
    url,
    sha256,
    size,
    requires: validateRequirements(record.requires),
  };
}

export function validatePointer(
  value: unknown,
  context: PointerValidationContext,
): ComponentPointerV1 {
  try {
    return validatePointerValue(value, context);
  } catch (error) {
    if (error instanceof ContractViolation) {
      if (error.code === 'pointer_invalid' || error.code === 'artifact_too_large') throw error;
      throw new ContractViolation('pointer_invalid', error.message);
    }
    throw error;
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('render_invalid', `${label} is not an allowed value`);
  }
  return value as T;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail('render_invalid', `${label} must be boolean`);
  return value;
}

interface TextBudget {
  bytes: number;
}

function uiText(value: unknown, maxBytes: number, label: string, budget: TextBudget): string {
  const text = boundedString(value, maxBytes, label);
  budget.bytes += utf8Bytes(text);
  if (budget.bytes > LIMITS.uiTextBytes) fail('render_invalid', 'aggregate UI text exceeds the limit');
  return text;
}

function handlerId(value: unknown, label: string): string {
  const id = boundedString(value, 64, label);
  if (!NODE_ID.test(id)) fail('render_invalid', `${label} has an invalid format`);
  return id;
}

function validateProps(
  type: UiNodeType,
  raw: unknown,
  budget: TextBudget,
  context: UiValidationContext,
): Record<string, unknown> {
  switch (type) {
    case 'screen': {
      const props = exactObject(raw, ['title'], [], 'screen.props');
      return { title: uiText(props.title, LIMITS.textBytes, 'screen.props.title', budget) };
    }
    case 'stack': {
      const props = exactObject(raw, [], ['direction', 'gap', 'align'], 'stack.props');
      return {
        direction: props.direction === undefined
          ? 'vertical'
          : enumValue(props.direction, ['vertical', 'horizontal'], 'stack.props.direction'),
        gap: props.gap === undefined
          ? 'medium'
          : enumValue(props.gap, ['none', 'small', 'medium', 'large'], 'stack.props.gap'),
        align: props.align === undefined
          ? 'stretch'
          : enumValue(props.align, ['start', 'center', 'end', 'stretch'], 'stack.props.align'),
      };
    }
    case 'grid': {
      const props = exactObject(raw, ['columns'], ['gap'], 'grid.props');
      const columns = safePositiveInteger(props.columns, 'grid.props.columns');
      if (columns > 6) fail('render_invalid', 'grid.props.columns exceeds 6');
      return {
        columns,
        gap: props.gap === undefined
          ? 'medium'
          : enumValue(props.gap, ['none', 'small', 'medium', 'large'], 'grid.props.gap'),
      };
    }
    case 'section': {
      const props = exactObject(raw, ['heading'], ['description'], 'section.props');
      const description = optionalString(props.description, LIMITS.textBytes, 'section.props.description');
      if (description !== undefined) {
        budget.bytes += utf8Bytes(description);
        if (budget.bytes > LIMITS.uiTextBytes) fail('render_invalid', 'aggregate UI text exceeds the limit');
      }
      return {
        heading: uiText(props.heading, LIMITS.textBytes, 'section.props.heading', budget),
        ...(description === undefined ? {} : { description }),
      };
    }
    case 'text': {
      const props = exactObject(raw, ['text'], ['tone', 'emphasis'], 'text.props');
      return {
        text: uiText(props.text, LIMITS.textBytes, 'text.props.text', budget),
        tone: props.tone === undefined
          ? 'default'
          : enumValue(props.tone, ['default', 'muted', 'positive', 'warning', 'critical'], 'text.props.tone'),
        emphasis: props.emphasis === undefined
          ? 'normal'
          : enumValue(props.emphasis, ['normal', 'strong'], 'text.props.emphasis'),
      };
    }
    case 'status': {
      const props = exactObject(raw, ['label', 'state'], ['detail'], 'status.props');
      const detail = optionalString(props.detail, LIMITS.textBytes, 'status.props.detail');
      if (detail !== undefined) budget.bytes += utf8Bytes(detail);
      if (budget.bytes > LIMITS.uiTextBytes) fail('render_invalid', 'aggregate UI text exceeds the limit');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'status.props.label', budget),
        state: enumValue(props.state, [
          'idle',
          'pending',
          'accepted',
          'applied',
          'failed',
          'stale',
          'outcome_unknown',
        ], 'status.props.state'),
        ...(detail === undefined ? {} : { detail }),
      };
    }
    case 'button': {
      const props = exactObject(raw, ['label', 'handler'], ['variant', 'disabled', 'pending'], 'button.props');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'button.props.label', budget),
        handler: handlerId(props.handler, 'button.props.handler'),
        variant: props.variant === undefined
          ? 'primary'
          : enumValue(props.variant, ['primary', 'secondary', 'danger'], 'button.props.variant'),
        disabled: optionalBoolean(props.disabled, 'button.props.disabled') ?? false,
        pending: optionalBoolean(props.pending, 'button.props.pending') ?? false,
      };
    }
    case 'toggle': {
      const props = exactObject(raw, ['label', 'value', 'handler'], ['disabled', 'pending'], 'toggle.props');
      if (typeof props.value !== 'boolean') fail('render_invalid', 'toggle.props.value must be boolean');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'toggle.props.label', budget),
        value: props.value,
        handler: handlerId(props.handler, 'toggle.props.handler'),
        disabled: optionalBoolean(props.disabled, 'toggle.props.disabled') ?? false,
        pending: optionalBoolean(props.pending, 'toggle.props.pending') ?? false,
      };
    }
    case 'input': {
      const props = exactObject(raw, ['label', 'value', 'handler'], ['input_type', 'max_length', 'disabled'], 'input.props');
      const value = typeof props.value === 'string' ? props.value : fail('render_invalid', 'input.props.value must be a string');
      if (utf8Bytes(value) > LIMITS.inputBytes) fail('render_invalid', 'input.props.value exceeds the limit');
      const maxLength = props.max_length === undefined
        ? 1_024
        : safePositiveInteger(props.max_length, 'input.props.max_length');
      if (maxLength > 16_384) fail('render_invalid', 'input.props.max_length exceeds the limit');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'input.props.label', budget),
        value,
        handler: handlerId(props.handler, 'input.props.handler'),
        input_type: props.input_type === undefined
          ? 'text'
          : enumValue(props.input_type, ['text', 'number', 'email', 'search'], 'input.props.input_type'),
        max_length: maxLength,
        disabled: optionalBoolean(props.disabled, 'input.props.disabled') ?? false,
      };
    }
    case 'select': {
      const props = exactObject(raw, ['label', 'value', 'options', 'handler'], ['disabled'], 'select.props');
      const optionInputs = denseArray(
        props.options,
        LIMITS.selectOptions,
        'select.props.options',
        'render_invalid',
      );
      const seenValues = new Set<string>();
      const options = optionInputs.map((option, index) => {
        const record = exactObject(option, ['value', 'label'], [], `select.props.options[${index}]`);
        const value = boundedString(record.value, 256, `select.props.options[${index}].value`);
        if (seenValues.has(value)) fail('render_invalid', 'select option values must be unique');
        seenValues.add(value);
        return {
          value,
          label: uiText(record.label, LIMITS.textBytes, `select.props.options[${index}].label`, budget),
        };
      });
      const value = boundedString(props.value, 256, 'select.props.value');
      if (!seenValues.has(value)) fail('render_invalid', 'select.props.value must name an option');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'select.props.label', budget),
        value,
        options,
        handler: handlerId(props.handler, 'select.props.handler'),
        disabled: optionalBoolean(props.disabled, 'select.props.disabled') ?? false,
      };
    }
    case 'progress': {
      const props = exactObject(raw, ['label', 'value'], [], 'progress.props');
      const value = finiteNumber(props.value, 'progress.props.value');
      if (value < 0 || value > 1) fail('render_invalid', 'progress.props.value must be between 0 and 1');
      return {
        label: uiText(props.label, LIMITS.textBytes, 'progress.props.label', budget),
        value,
      };
    }
    case 'media': {
      const props = exactObject(raw, ['label', 'handle'], [], 'media.props');
      const handle = validateResourceName(props.handle, 'media.props.handle');
      if (!context.mediaHandles?.has(handle)) fail('capability_denied', `Media handle is not granted: ${handle}`);
      return {
        label: uiText(props.label, LIMITS.textBytes, 'media.props.label', budget),
        handle,
      };
    }
    default:
      return fail('render_invalid', `Unknown node type: ${String(type)}`);
  }
}

const CONTAINER_TYPES = new Set<UiNodeType>(['screen', 'stack', 'grid', 'section']);
const NODE_TYPES = new Set<UiNodeType>([
  'screen',
  'stack',
  'grid',
  'section',
  'text',
  'status',
  'button',
  'toggle',
  'input',
  'select',
  'progress',
  'media',
]);

function validateUiTreeValue(value: unknown, context: UiValidationContext): UiNode {
  interface PendingNode {
    input: unknown;
    depth: number;
    assign: (node: UiNode) => void;
  }

  let root: UiNode | undefined;
  const stack: PendingNode[] = [{ input: value, depth: 1, assign: (node) => { root = node; } }];
  const seenObjects = new WeakSet<object>();
  const seenIds = new Set<string>();
  const budget: TextBudget = { bytes: 0 };
  let nodeCount = 0;

  while (stack.length > 0) {
    const pending = stack.pop()!;
    if (pending.depth > LIMITS.uiDepth) fail('render_invalid', 'UI tree exceeds the depth limit');
    const record = exactObject(pending.input, ['id', 'type', 'props'], ['children'], 'node');
    if (seenObjects.has(record)) fail('render_invalid', 'UI tree contains a cycle or reused node');
    seenObjects.add(record);
    nodeCount += 1;
    if (nodeCount > LIMITS.uiNodes) fail('render_invalid', 'UI tree exceeds the node limit');

    const id = handlerId(record.id, 'node.id');
    if (seenIds.has(id)) fail('render_invalid', `Duplicate node ID: ${id}`);
    seenIds.add(id);
    if (typeof record.type !== 'string' || !NODE_TYPES.has(record.type as UiNodeType)) {
      fail('render_invalid', `Unknown node type: ${String(record.type)}`);
    }
    const type = record.type as UiNodeType;
    const node: UiNode = { id, type, props: validateProps(type, record.props, budget, context) };
    pending.assign(node);

    if (CONTAINER_TYPES.has(type)) {
      const children = denseArray(
        record.children ?? [],
        LIMITS.uiNodes,
        `${type}.children`,
        'render_invalid',
      );
      if (seenObjects.has(children)) fail('render_invalid', 'UI tree reuses a children array');
      seenObjects.add(children);
      node.children = new Array<UiNode>(children.length);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({
          input: children[index],
          depth: pending.depth + 1,
          assign: (child) => { node.children![index] = child; },
        });
      }
    } else if (Object.hasOwn(record, 'children')) {
      fail('render_invalid', `${type} cannot have children`);
    }
  }

  if (!root || root.type !== 'screen') fail('render_invalid', 'UI root must be a screen');
  return root;
}

export function validateUiTree(value: unknown, context: UiValidationContext = {}): UiNode {
  try {
    return validateUiTreeValue(value, context);
  } catch (error) {
    if (error instanceof ContractViolation) {
      if (error.code === 'render_invalid' || error.code === 'capability_denied') throw error;
      throw new ContractViolation('render_invalid', error.message);
    }
    throw error;
  }
}

export interface MeasureOptions {
  maxBytes?: number;
  maxDepth?: number;
  allowBinary?: boolean;
}

export function measureStructuredValue(value: unknown, options: MeasureOptions = {}): number {
  const maxBytes = options.maxBytes ?? LIMITS.envelopeBytes;
  const maxDepth = options.maxDepth ?? 32;
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let bytes = 0;
  let values = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    values += 1;
    if (values > LIMITS.structuredValues) {
      fail('bridge_protocol_violation', 'structured value has too many members');
    }
    if (current.depth > maxDepth) fail('bridge_protocol_violation', 'structured value is too deep');
    const item = current.value;
    if (item === null) bytes += 4;
    else if (typeof item === 'boolean') bytes += 1;
    else if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('bridge_protocol_violation', 'structured number must be finite');
      bytes += 8;
    } else if (typeof item === 'string') {
      if (CONTROL_CHARACTER.test(item) && item.includes('\0')) {
        fail('bridge_protocol_violation', 'structured string contains NUL');
      }
      bytes += utf8Bytes(item) + 4;
    } else if (item instanceof Uint8Array) {
      if (!options.allowBinary) fail('bridge_protocol_violation', 'binary value is not allowed here');
      bytes += item.byteLength + 4;
    } else if (item instanceof ArrayBuffer) {
      if (!options.allowBinary) fail('bridge_protocol_violation', 'binary value is not allowed here');
      bytes += item.byteLength + 4;
    } else if (Array.isArray(item)) {
      if (seen.has(item)) fail('bridge_protocol_violation', 'structured value contains a cycle');
      seen.add(item);
      denseArray(
        item,
        LIMITS.structuredArrayItems,
        'structured array',
        'bridge_protocol_violation',
      );
      bytes += 4;
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], depth: current.depth + 1 });
      }
    } else if (isPlainRecord(item)) {
      if (seen.has(item)) fail('bridge_protocol_violation', 'structured value contains a cycle');
      seen.add(item);
      bytes += 4;
      for (const key of ownKeys(item)) {
        bytes += utf8Bytes(key) + 4;
        stack.push({ value: item[key], depth: current.depth + 1 });
      }
    } else {
      fail('bridge_protocol_violation', 'unsupported structured value');
    }
    if (bytes > maxBytes) fail('bridge_protocol_violation', 'structured value exceeds the byte limit');
  }
  return bytes;
}

export interface EnvelopeContext {
  instance: string;
  epoch: number;
  expectedSeq: number;
  allowedKinds: ReadonlySet<string>;
  allowBinary?: boolean;
  maxBytes?: number;
}

export function validateEnvelope(value: unknown, context: EnvelopeContext): Envelope {
  const record = exactObject(value, ['v', 'instance', 'epoch', 'seq', 'kind', 'payload'], [], 'envelope');
  if (record.v !== BROKER_PROTOCOL) fail('bridge_protocol_violation', 'unsupported broker protocol');
  if (record.instance !== context.instance || typeof record.instance !== 'string'
    || !INSTANCE_ID.test(record.instance)) {
    fail('bridge_protocol_violation', 'instance does not match');
  }
  if (record.epoch !== context.epoch) fail('bridge_protocol_violation', 'epoch does not match');
  if (record.seq !== context.expectedSeq) fail('bridge_protocol_violation', 'sequence is not contiguous');
  if (typeof record.kind !== 'string' || !context.allowedKinds.has(record.kind)) {
    fail('bridge_protocol_violation', `message kind is not allowed: ${String(record.kind)}`);
  }
  const measureOptions: MeasureOptions = {};
  if (context.allowBinary !== undefined) measureOptions.allowBinary = context.allowBinary;
  if (context.maxBytes !== undefined) measureOptions.maxBytes = context.maxBytes;
  measureStructuredValue(record.payload, measureOptions);
  return {
    v: BROKER_PROTOCOL,
    instance: record.instance,
    epoch: record.epoch as number,
    seq: record.seq as number,
    kind: record.kind,
    payload: record.payload,
  };
}

export function assertInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID.test(value)) {
    fail('bridge_protocol_violation', 'invalid instance identifier');
  }
  return value;
}
