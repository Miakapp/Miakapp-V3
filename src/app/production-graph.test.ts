import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * Vitest runs with the project root as its working directory. The test asserts
 * that below rather than trusting it, because a wrong root would build the
 * wrong thing and still report success.
 */
const repositoryRoot = process.cwd();

/**
 * Modules that must never enter the graph of the bundle we serve to visitors,
 * with the reason each one is dangerous. These are not stylistic bans: every
 * entry here executes something, or carries something, that is safe only in a
 * test.
 */
const FORBIDDEN_MODULES: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: 'component-runtime/src/host-harness.ts',
    reason:
      'it self-installs on import and plants a decoy Firebase token in window and localStorage',
  },
  {
    path: 'component-runtime/test/',
    reason: 'it is the sandbox harness server, which grants capabilities no deployment declares',
  },
  {
    path: 'src/test/',
    reason: 'it is the test setup, which installs doubles over browser APIs',
  },
];

/**
 * The decoy the harness writes. It is a plain string literal, so it survives
 * minification: if the harness ever reaches an emitted chunk, this marker is in
 * the bytes we serve, whatever the module graph says.
 */
const HARNESS_DECOY_MARKER = 'firebase-secret-must-not-cross';

/**
 * `src/app/` legitimately imports value modules that sit in the very same
 * directory as the harness (`contract.ts`, `artifact.ts`, `artifact-cache.ts`,
 * `release-state.ts`), so the boundary this guards is one autocomplete slip, or
 * one barrel re-export, away from shipping. A grep would miss a transitive
 * import; this walks the real production graph instead.
 */
async function buildProductionGraph(): Promise<{
  readonly moduleIds: readonly string[];
  readonly code: string;
}> {
  const moduleIds: string[] = [];

  const result = await build({
    root: repositoryRoot,
    logLevel: 'silent',
    build: { write: false },
    plugins: [
      {
        name: 'collect-production-graph',
        moduleParsed(moduleInfo) {
          moduleIds.push(moduleInfo.id.replaceAll('\\', '/'));
        },
      },
    ],
  });

  const outputs: Rollup.RollupOutput[] = Array.isArray(result)
    ? result
    : [result as Rollup.RollupOutput];
  const code = outputs
    .flatMap((output) => output.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : String(chunk.source)))
    .join('\n');

  return { moduleIds, code };
}

describe('production module graph', () => {
  it('excludes every test-only module, and is not vacuously empty', async () => {
    expect(existsSync(join(repositoryRoot, 'index.html'))).toBe(true);

    const { moduleIds, code } = await buildProductionGraph();

    // Without this, a build that resolved nothing would pass every assertion
    // below by producing nothing to assert against.
    expect(moduleIds.length).toBeGreaterThan(10);
    expect(moduleIds.some((id) => id.endsWith('/src/main.tsx'))).toBe(true);

    for (const { path, reason } of FORBIDDEN_MODULES) {
      const offenders = moduleIds.filter((id) => id.includes(path));
      expect(offenders, `${path} reached the production graph, and ${reason}`).toEqual([]);
    }

    expect(code).not.toContain(HARNESS_DECOY_MARKER);
  }, 60_000);
});
