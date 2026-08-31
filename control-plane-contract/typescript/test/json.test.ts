import { describe, expect, test } from 'bun:test';

import { ContractViolation, parseBoundedJson } from '../src/json.js';

const limits = {
  maximumBytes: 1_024,
  maximumDepth: 4,
  maximumValues: 32,
  maximumStringBytes: 64,
  maximumArrayItems: 8,
  maximumObjectEntries: 8,
};

describe('bounded JSON', () => {
  test('returns null-prototype frozen objects', () => {
    const parsed = parseBoundedJson('{"safe":[1,true,null]}', limits);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen((parsed as { safe: unknown }).safe)).toBe(true);
  });

  test.each([
    '{"a":1,"a":2}',
    '{"__proto__":{}}',
    '{"value":"\\ud800"}',
    '[1,2,]',
    '{"a":1} trailing',
  ])('rejects malformed or ambiguous input: %s', (source) => {
    expect(() => parseBoundedJson(source, limits)).toThrow(ContractViolation);
  });

  test('enforces aggregate limits before returning a value', () => {
    expect(() => parseBoundedJson('[1,2,3]', { ...limits, maximumValues: 2 }))
      .toThrow(/value limit/);
    expect(() => parseBoundedJson('[[[[[]]]]]', limits)).toThrow(/depth limit/);
  });
});
