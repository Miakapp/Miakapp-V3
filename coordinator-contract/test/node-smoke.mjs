import assert from 'node:assert/strict';
import {
  ApplicationCallError,
  CONTRACT_CORPUS_SCHEMA,
  DEFAULT_CONTRACT_HOOK_TIMEOUT_MS,
  EventDirection,
  loadCoordinatorContractCorpus,
  replayContractScenario,
} from '@miakapp/coordinator-contract';

const corpus = await loadCoordinatorContractCorpus();
let observation;
const subject = {
  reset(setup) {
    const scenario = corpus.scenarios.find(({ id }) => id === setup.scenario_id);
    assert.ok(scenario);
    observation = structuredClone(scenario.expected);
  },
  dispatch() {},
  observe() {
    assert.ok(observation);
    return observation;
  },
};

const result = await replayContractScenario(corpus, 'sdk_inert_construction', subject);
assert.equal(result.scenario_id, 'sdk_inert_construction');
assert.equal(corpus.schema, CONTRACT_CORPUS_SCHEMA);
assert.equal(DEFAULT_CONTRACT_HOOK_TIMEOUT_MS, 5_000);
assert.equal(EventDirection.publishToUsers, 0x02);
assert.equal(new ApplicationCallError(2001).code, 2001);
assert.throws(() => new ApplicationCallError(2001, '\ud800'), TypeError);
assert.throws(
  () => new ApplicationCallError(2001, 'Synthetic application failure', 'yes'),
  TypeError,
);
