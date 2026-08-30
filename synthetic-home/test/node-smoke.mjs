import assert from 'node:assert/strict';
import {
  DEFAULT_REPLAY_HOOK_TIMEOUT_MS,
  loadSyntheticHomeCorpus,
  replayScenario,
} from '@miakapp/synthetic-home-conformance';

function mergeContext(base, patch) {
  const flows = {};
  for (const flowId of new Set([...Object.keys(base.flows), ...Object.keys(patch.flows)])) {
    flows[flowId] = { ...(base.flows[flowId] ?? {}), ...(patch.flows[flowId] ?? {}) };
  }
  return { global: { ...base.global, ...patch.global }, flows };
}

const corpus = await loadSyntheticHomeCorpus();
let setup;
let scenario;
const subject = {
  reset(value) {
    setup = value;
    scenario = corpus.scenarios.scenarios.find(({ id }) => id === value.scenario_id);
  },
  dispatch() {},
  observe() {
    assert.ok(setup);
    assert.ok(scenario);
    return {
      state: { ...setup.state, ...scenario.expected.state_patch },
      context: mergeContext(setup.context, scenario.expected.context_patch),
      recorded_commands: scenario.expected.recorded_commands,
      notification_intents: scenario.expected.notification_intents,
      lifecycle: scenario.expected.lifecycle,
      operations: scenario.expected.operations,
    };
  },
};

const result = await replayScenario(corpus, 'syn_scenario_bootstrap', subject);
assert.equal(result.scenario_id, 'syn_scenario_bootstrap');
assert.equal(DEFAULT_REPLAY_HOOK_TIMEOUT_MS, 5_000);
