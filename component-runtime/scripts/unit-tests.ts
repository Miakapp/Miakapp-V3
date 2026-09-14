// Runs every unit test file in test/, discovered rather than listed by hand.
//
// `bun test` treats a positional argument as a substring filter over paths, not
// as a directory scope, and its default discovery also claims `*.spec.ts` — the
// Playwright corpus, which cannot run under the bun runner. Naming the files one
// by one avoided that, but a file nobody remembered to name never ran at all.
// Discovery keeps the two suites apart without depending on memory.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const UNIT_TEST_SUFFIX = '.test.ts';

/**
 * Selects the unit test files from one directory listing, in a stable order.
 * Playwright specs (`*.spec.ts`) and shared helpers (`server.ts`) are not tests
 * for this runner and are left out.
 */
export function selectUnitTests(entries: readonly string[]): string[] {
  return entries.filter((entry) => entry.endsWith(UNIT_TEST_SUFFIX)).sort();
}

export function discoverUnitTests(testDir: string): string[] {
  return selectUnitTests(readdirSync(testDir));
}

async function main(): Promise<number> {
  const testDir = join(import.meta.dir, '..', 'test');
  const files = discoverUnitTests(testDir);

  // An empty discovery is a broken runner, not a green suite: handing `bun test`
  // no files would make it fall back to its own discovery and pick up the
  // Playwright specs. Refusing is the only outcome that cannot be mistaken for
  // a pass.
  if (files.length === 0) {
    console.error(`No ${UNIT_TEST_SUFFIX} files found in ${testDir}`);
    return 1;
  }

  const child = Bun.spawn({
    cmd: ['bun', 'test', ...files.map((file) => join('test', file))],
    cwd: join(import.meta.dir, '..'),
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return await child.exited;
}

if (import.meta.main) {
  process.exit(await main());
}
