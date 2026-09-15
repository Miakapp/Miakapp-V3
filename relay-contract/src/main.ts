/**
 * Runs the RFC 0001 relay conformance corpus against one subject.
 *
 * Usage:
 *   bun run src/main.ts -- <subject command> [arguments...]
 *   MIAKAPP_RELAY_SCENARIO=<substring> bun run src/main.ts -- <subject command>
 */
import corpusDocument from '../fixtures/v1/scenarios.json' with { type: 'json' };
import { runCorpus, type Corpus } from './runner.ts';

const corpus = corpusDocument as unknown as Corpus;

const command = process.argv.slice(2).filter((argument) => argument !== '--');
if (command.length === 0) {
  console.error('Usage: bun run src/main.ts -- <subject command> [arguments...]');
  process.exit(64);
}

const filter = process.env['MIAKAPP_RELAY_SCENARIO'];
const results = await runCorpus(corpus, { command }, filter);

let failed = 0;
for (const result of results) {
  if (result.passed) {
    console.log(`  ok   ${result.name}`);
    continue;
  }
  failed += 1;
  console.log(`  FAIL ${result.name}`);
  console.log(`       ${result.failure}`);
}

const total = results.length;
console.log(`\n${total - failed}/${total} scenarios passed`);
if (total === 0) {
  console.error('no scenario matched the filter');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
