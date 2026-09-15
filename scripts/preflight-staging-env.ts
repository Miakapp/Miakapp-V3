/**
 * Applies the shell's own configuration rules to the staging environment
 * before `vite build` bakes it into a bundle.
 *
 * The environment is resolved with Vite's `loadEnv`, not with a private parser,
 * so this reads exactly the files and precedence the build will read. A
 * reimplementation would eventually disagree with the build, and a preflight
 * that disagrees with the thing it guards is worse than none.
 */
import { loadEnv } from 'vite';

import { collectStagingEnvFaults } from '../src/app/staging-env.ts';

const mode = process.argv[2] ?? 'staging';
const root = process.cwd();

// The `VITE_` prefix rather than `VITE_MIAKAPP_`: a key misspelled as
// `VITE_MIKAAPP_…` must still reach the closed-set check that names it.
const env = loadEnv(mode, root, 'VITE_');
const faults = collectStagingEnvFaults(env);

if (faults.length > 0) {
  console.error(`The ${mode} environment cannot produce a working bundle:`);
  for (const fault of faults) console.error(`  - ${fault}`);
  console.error(
    'These values are read in the browser, where a missing one blanks the page and a misspelled one disables its feature in silence.',
  );
  process.exit(1);
}

console.log(`The ${mode} environment satisfies every rule the shell applies at runtime.`);
