export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonLimits {
  maximumBytes: number;
  maximumDepth: number;
  maximumValues: number;
  maximumStringBytes: number;
  maximumArrayItems: number;
  maximumObjectEntries: number;
}

export class ContractViolation extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContractViolation';
    this.code = code;
  }
}

const UTF8 = new TextEncoder();
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || following < 0xdc00 || following > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
    return Object.freeze(value) as JsonValue[];
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeJson(entry);
    return Object.freeze(value);
  }
  return value;
}

export function parseBoundedJson(input: Uint8Array | string, limits: JsonLimits): JsonValue {
  const bytes = typeof input === 'string' ? UTF8.encode(input) : input;
  if (bytes.byteLength > limits.maximumBytes) {
    throw new ContractViolation('limit_exceeded', 'JSON input exceeds its byte limit');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ContractViolation('malformed_json', 'JSON input is not valid UTF-8');
  }

  let index = 0;
  let values = 0;

  const fail = (message: string): never => {
    throw new ContractViolation('malformed_json', `${message} at byte ${index}`);
  };

  const skipWhitespace = (): void => {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      index += 1;
    }
  };

  const consumeValue = (): void => {
    values += 1;
    if (values > limits.maximumValues) {
      throw new ContractViolation('limit_exceeded', 'JSON input exceeds its value limit');
    }
  };

  const parseString = (): string => {
    if (text[index] !== '"') fail('expected JSON string');
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === '"') {
        index += 1;
        const decoded: unknown = (() => {
          try {
            return JSON.parse(text.slice(start, index)) as unknown;
          } catch {
            return fail('invalid JSON string');
          }
        })();
        if (typeof decoded !== 'string') {
          fail('JSON string is not text');
        }
        if (hasUnpairedSurrogate(decoded as string)) {
          fail('JSON string contains invalid Unicode');
        }
        const decodedString = decoded as string;
        if (UTF8.encode(decodedString).byteLength > limits.maximumStringBytes) {
          throw new ContractViolation('limit_exceeded', 'JSON string exceeds its byte limit');
        }
        return decodedString;
      }
      if (!escaped && character === '\\') {
        escaped = true;
      } else {
        escaped = false;
      }
      index += 1;
    }
    return fail('unterminated JSON string');
  };

  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
    if (match === null) return fail('invalid JSON number');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return fail('JSON number is not finite');
    return value;
  };

  const parseValue = (depth: number): JsonValue => {
    if (depth > limits.maximumDepth) {
      throw new ContractViolation('limit_exceeded', 'JSON input exceeds its depth limit');
    }
    consumeValue();
    skipWhitespace();
    const character = text[index];
    if (character === '"') return parseString();
    if (character === '-' || (character !== undefined && character >= '0' && character <= '9')) {
      return parseNumber();
    }
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    if (character === '[') {
      index += 1;
      const array: JsonValue[] = [];
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return array;
      }
      while (true) {
        if (array.length >= limits.maximumArrayItems) {
          throw new ContractViolation('limit_exceeded', 'JSON array exceeds its item limit');
        }
        array.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return array;
        }
        if (text[index] !== ',') return fail('expected comma or closing bracket');
        index += 1;
        skipWhitespace();
      }
    }
    if (character === '{') {
      index += 1;
      const object: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
      const keys = new Set<string>();
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return object;
      }
      while (true) {
        if (keys.size >= limits.maximumObjectEntries) {
          throw new ContractViolation('limit_exceeded', 'JSON object exceeds its entry limit');
        }
        const key = parseString();
        if (keys.has(key)) return fail('JSON object contains a duplicate key');
        if (FORBIDDEN_KEYS.has(key)) return fail('JSON object contains a forbidden key');
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') return fail('expected colon');
        index += 1;
        object[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return object;
        }
        if (text[index] !== ',') return fail('expected comma or closing brace');
        index += 1;
        skipWhitespace();
      }
    }
    return fail('invalid JSON value');
  };

  skipWhitespace();
  const parsed = parseValue(1);
  skipWhitespace();
  if (index !== text.length) fail('JSON input has trailing data');
  return freezeJson(parsed);
}

export function objectValue(value: JsonValue, label: string): { [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ContractViolation('invalid_fixture', `${label} must be an object`);
  }
  return value;
}

export function arrayValue(value: JsonValue, label: string): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ContractViolation('invalid_fixture', `${label} must be an array`);
  }
  return value;
}

export function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string') {
    throw new ContractViolation('invalid_fixture', `${label} must be a string`);
  }
  return value;
}

export function booleanValue(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ContractViolation('invalid_fixture', `${label} must be a boolean`);
  }
  return value;
}

export function integerValue(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ContractViolation('invalid_fixture', `${label} must be a safe integer`);
  }
  return value;
}

export function assertKeys(
  value: { [key: string]: JsonValue },
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) throw new ContractViolation('invalid_fixture', `${label} is missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ContractViolation('invalid_fixture', `${label} has unknown field ${key}`);
  }
}
