import { apiError } from './errors.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const REQUEST_JSON_LIMITS = Object.freeze({
  maximumBytes: 16_384,
  maximumDepth: 16,
  maximumValues: 2_048,
  maximumStringBytes: 4_096,
  maximumArrayItems: 256,
  maximumObjectEntries: 256,
});

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

export function parseRequestJson(input: Uint8Array): JsonValue {
  const limits = REQUEST_JSON_LIMITS;
  if (input.byteLength > limits.maximumBytes) throw apiError('limit_exceeded');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw apiError('invalid_request');
  }

  let index = 0;
  let values = 0;
  const fail = (): never => { throw apiError('invalid_request'); };
  const skipWhitespace = (): void => {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      index += 1;
    }
  };
  const consumeValue = (): void => {
    values += 1;
    if (values > limits.maximumValues) throw apiError('limit_exceeded');
  };
  const parseString = (): string => {
    if (text[index] !== '"') return fail();
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === '"') {
        index += 1;
        let decoded: unknown;
        try {
          decoded = JSON.parse(text.slice(start, index)) as unknown;
        } catch {
          return fail();
        }
        if (typeof decoded !== 'string' || hasUnpairedSurrogate(decoded)) return fail();
        if (UTF8.encode(decoded).byteLength > limits.maximumStringBytes) throw apiError('limit_exceeded');
        return decoded;
      }
      if (!escaped && character === '\\') escaped = true;
      else escaped = false;
      index += 1;
    }
    return fail();
  };
  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
    if (match === null) return fail();
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return fail();
    return value;
  };
  const parseValue = (depth: number): JsonValue => {
    if (depth > limits.maximumDepth) throw apiError('limit_exceeded');
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
        if (array.length >= limits.maximumArrayItems) throw apiError('limit_exceeded');
        array.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return array;
        }
        if (text[index] !== ',') return fail();
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
        if (keys.size >= limits.maximumObjectEntries) throw apiError('limit_exceeded');
        const key = parseString();
        if (keys.has(key) || FORBIDDEN_KEYS.has(key)) return fail();
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') return fail();
        index += 1;
        object[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return object;
        }
        if (text[index] !== ',') return fail();
        index += 1;
        skipWhitespace();
      }
    }
    return fail();
  };

  skipWhitespace();
  const parsed = parseValue(1);
  skipWhitespace();
  if (index !== text.length) fail();
  return freezeJson(parsed);
}

export function objectValue(value: JsonValue): { [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw apiError('invalid_request');
  return value;
}

export function stringValue(value: JsonValue | undefined): string {
  if (typeof value !== 'string') throw apiError('invalid_request');
  return value;
}

export function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) throw apiError('invalid_request');
  return value.map((entry) => stringValue(entry));
}

export function assertExactKeys(
  value: { [key: string]: JsonValue },
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value))) throw apiError('invalid_request');
  if (Object.keys(value).some((key) => !allowed.has(key))) throw apiError('invalid_request');
}
