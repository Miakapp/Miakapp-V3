// Which runner owns which file in test/.
//
// Two runners share this directory and cannot run each other's files: the bun
// runner executes the unit contract, Playwright drives the hostile browser
// corpus. Playwright's own default pattern claims `*.test.ts` as well, so the
// split has to be stated somewhere both sides read. That is this file.

/** Playwright owns these. */
export const SPEC_SUFFIX = '.spec.ts';

/** The bun runner owns these. */
export const UNIT_SUFFIX = '.test.ts';

/**
 * The pattern `playwright.config.ts` hands to Playwright. It selects by suffix
 * instead of naming files, so a spec added to `test/` runs without anyone
 * remembering to register it.
 */
export const SPEC_GLOB = `**/*${SPEC_SUFFIX}`;

/**
 * Files in `test/` that are not tests for either runner. Listing them by hand is
 * the point: a new file that is neither a spec nor a unit test has to be
 * declared here, which is the moment someone decides whether it was meant to
 * run.
 */
export const HELPERS: readonly string[] = ['server.ts', 'test-scope.ts'];

export type TestRole = 'spec' | 'unit' | 'helper' | 'unclaimed';

export function classify(entry: string): TestRole {
  if (entry.endsWith(SPEC_SUFFIX)) return 'spec';
  if (entry.endsWith(UNIT_SUFFIX)) return 'unit';
  if (HELPERS.includes(entry)) return 'helper';
  return 'unclaimed';
}
