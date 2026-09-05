import { fileURLToPath } from 'node:url';

import { validateBrowserRelayPlan } from './contract.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node validate.mjs <browser-relay-plan.json>');
    process.exitCode = 2;
  } else {
    try {
      const plan = validateBrowserRelayPlan(process.argv[2]);
      console.log([
        `Validated ${plan.schema} for ${plan.target.project_id}.`,
        'The live matrix is rebased and reviewed but not deployed; it grants no cloud mutation and contains no acceptance evidence.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging browser-relay plan is invalid');
      process.exitCode = 1;
    }
  }
}
