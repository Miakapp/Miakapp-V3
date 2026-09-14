import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import playwrightConfig from '../playwright.config';
import { HELPERS, SPEC_GLOB, SPEC_SUFFIX, UNIT_SUFFIX, classify } from './test-scope';

const testDir = join(import.meta.dir);
const entries = readdirSync(testDir).sort();

// The real matcher, against the real pattern the config exports. Asserting the
// string alone would only prove the config quotes a constant, not that the
// constant selects the files on disk.
const specGlob = new Bun.Glob(SPEC_GLOB);
const matchesSpecGlob = (entry: string): boolean => specGlob.match(join('test', entry));

describe('browser corpus discovery', () => {
  test('the configured pattern is the shared one, as a pattern', () => {
    // A regex or an array would still be a valid Playwright config and would
    // silently stop being what this file reasons about.
    expect(playwrightConfig.testMatch).toBe(SPEC_GLOB);
  });

  test('every spec on disk is selected', () => {
    const specs = entries.filter((entry) => entry.endsWith(SPEC_SUFFIX));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((entry) => !matchesSpecGlob(entry))).toEqual([]);
  });

  test('no unit test is selected', () => {
    // Playwright's default pattern claims `*.test.ts` too. Those files import
    // `bun:test` and cannot run under Playwright, so the overlap has to stay
    // empty.
    const units = entries.filter((entry) => entry.endsWith(UNIT_SUFFIX));
    expect(units.length).toBeGreaterThan(0);
    expect(units.filter(matchesSpecGlob)).toEqual([]);
  });

  test('helpers are not selected', () => {
    expect(HELPERS.filter(matchesSpecGlob)).toEqual([]);
  });
});

describe('test directory partition', () => {
  test('every file in test/ is owned by a runner or declared a helper', () => {
    const unclaimed = entries.filter((entry) => classify(entry) === 'unclaimed');
    expect(unclaimed).toEqual([]);
  });

  test('every declared helper exists', () => {
    // A helper that was renamed or deleted leaves a stale exemption behind,
    // which would excuse a future file of the same name from ever running.
    expect(HELPERS.filter((helper) => !entries.includes(helper))).toEqual([]);
  });

  test('classification is exclusive', () => {
    for (const entry of entries) {
      const role = classify(entry);
      expect(role === 'spec').toBe(entry.endsWith(SPEC_SUFFIX));
      expect(role === 'unit').toBe(entry.endsWith(UNIT_SUFFIX));
    }
  });
});
