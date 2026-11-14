export const POINTER_SCHEMA = 'miakapp.component-pointer/1' as const;
export const COMPONENT_ABI = 'miakapp.component/1' as const;
/**
 * A whole-house application: the release is a document-owning program that runs
 * in a visible, opaque-origin frame. See `app-contract.ts`. `miakapp.component/1`
 * is still a valid pointer ABI for the control plane, but the shell no longer
 * draws it.
 */
export const APP_ABI = 'miakapp.app/1' as const;
export type ReleaseAbi = typeof COMPONENT_ABI | typeof APP_ABI;

export const LIMITS = Object.freeze({
  artifactBytes: 2_097_152,
  envelopeBytes: 524_288,
  structuredArrayItems: 4_096,
  structuredValues: 16_384,
  requirementEntries: 512,
  requirementListEntries: 256,
  outstandingCalls: 32,
  callDeadlineMs: 300_000,
  guestMessagesPerSecond: 120,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTER = /\p{Cc}/u;
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
  abi: ReleaseAbi;
  url: string;
  sha256: string;
  size: number;
  requires: CapabilityRequirements;
}

export interface PointerValidationContext {
  expectedHomeId: string;
  minimumGeneration?: number;
  allowedArtifactOrigins: ReadonlySet<string>;
  allowedPathPrefixes?: readonly string[];
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

function safePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail('invalid_integer', `${label} must be a positive safe integer`);
  }
  return value as number;
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

/**
 * Whether a requirement — an exact name or a `prefix.*` pattern — lies wholly
 * inside a set of allowed patterns. A wildcard requirement is covered only by
 * the same wildcard or a broader one; never by exact names, which could not
 * cover the paths it would admit.
 */
export function isPatternCovered(allowed: readonly string[], requirement: string): boolean {
  if (requirement.endsWith('.*')) {
    const base = validateResourceName(requirement.slice(0, -2));
    return allowed.some((pattern) => (
      pattern === requirement
      || (pattern.endsWith('.*') && base.startsWith(`${pattern.slice(0, -2)}.`))
    ));
  }
  return isCapabilityGranted(allowed, requirement);
}

/**
 * Keeps only the state paths a grant covers. Malformed paths are dropped rather
 * than thrown: the guest never asked for them and cannot fix them.
 */
export function selectGrantedState(
  values: Readonly<Record<string, unknown>>,
  granted: readonly string[],
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    try {
      if (isCapabilityGranted(granted, path)) selected[path] = value;
    } catch {
      // `isCapabilityGranted` rejects a malformed resource name.
    }
  }
  return selected;
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
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('pointer_invalid', 'url must be credential-free HTTPS without a query or fragment');
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
  if (record.abi !== COMPONENT_ABI && record.abi !== APP_ABI) {
    fail('pointer_invalid', 'unsupported component ABI');
  }
  const abi: ReleaseAbi = record.abi;
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
    abi,
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
