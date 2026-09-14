import { describe, expect, test } from 'bun:test';

import { discoverUnitTests, selectUnitTests, UNIT_TEST_SUFFIX } from '../scripts/unit-tests';

describe('unit test discovery', () => {
  test('claims the unit tests and leaves the Playwright corpus alone', () => {
    expect(
      selectUnitTests([
        'contract.test.ts',
        'runtime.spec.ts',
        'activation.spec.ts',
        'server.ts',
        'authoring.test.ts',
      ]),
    ).toEqual(['authoring.test.ts', 'contract.test.ts']);
  });

  test('order does not depend on how the filesystem listed the directory', () => {
    const listed = ['b.test.ts', 'a.test.ts', 'c.test.ts'];
    expect(selectUnitTests(listed)).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
    expect(selectUnitTests([...listed].reverse())).toEqual(selectUnitTests(listed));
  });

  test('a suffix that only appears mid-name is not a test file', () => {
    expect(selectUnitTests(['fixtures.test.ts.snap', 'not.test.tsx', 'real.test.ts'])).toEqual([
      'real.test.ts',
    ]);
  });

  test('an empty listing discovers nothing, so the runner can refuse it', () => {
    expect(selectUnitTests([])).toEqual([]);
  });

  // The guarantee that made this runner worth writing: this very file runs
  // without anyone having added it to a list.
  test('discovers this file from the real test directory', () => {
    const discovered = discoverUnitTests(import.meta.dir);
    expect(discovered).toContain('unit-discovery.test.ts');
    expect(discovered.every((file) => file.endsWith(UNIT_TEST_SUFFIX))).toBe(true);
    expect(discovered).not.toContain('server.ts');
  });
});
