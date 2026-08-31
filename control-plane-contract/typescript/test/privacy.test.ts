import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { assertSyntheticPrivacy, parseBoundedJson } from '../src/index.js';

const limits = {
  maximumBytes: 262_144,
  maximumDepth: 16,
  maximumValues: 16_384,
  maximumStringBytes: 16_384,
  maximumArrayItems: 512,
  maximumObjectEntries: 256,
};

describe('public fixture privacy', () => {
  test.each(['access-tokens.json', 'scenarios.json'])('%s contains only synthetic material', async (name) => {
    const value = parseBoundedJson(
      await readFile(new URL(`../../fixtures/v1/${name}`, import.meta.url)),
      limits,
    );
    expect(() => assertSyntheticPrivacy(value)).not.toThrow();
  });
});
