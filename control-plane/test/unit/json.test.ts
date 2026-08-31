import { describe, expect, test } from 'bun:test';

import { ApiError } from '../../src/errors.js';
import { parseRequestJson } from '../../src/json.js';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('bounded request JSON', () => {
  test('returns deeply frozen null-prototype objects', () => {
    const value = parseRequestJson(encode('{"nested":{"items":[1,true,null]}}'));
    expect(value).toEqual({ nested: { items: [1, true, null] } });
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.isFrozen(value)).toBe(true);
  });

  test.each([
    '{"a":1,"a":2}',
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '{"value":"\\ud800"}',
    '[1,2,]',
    '{"a":1} trailing',
  ])('rejects malformed or ambiguous input: %s', (source) => {
    expect(() => parseRequestJson(encode(source))).toThrow(ApiError);
  });

  test('enforces byte, depth, value, and string limits', () => {
    expect(() => parseRequestJson(new Uint8Array(16_385))).toThrow(/platform limit/i);
    expect(() => parseRequestJson(encode(`${'['.repeat(17)}0${']'.repeat(17)}`))).toThrow(/platform limit/i);
    expect(() => parseRequestJson(encode(`[${'0,'.repeat(2_048)}0]`))).toThrow(/platform limit/i);
    expect(() => parseRequestJson(encode(JSON.stringify('a'.repeat(4_097))))).toThrow(/platform limit/i);
  });
});
