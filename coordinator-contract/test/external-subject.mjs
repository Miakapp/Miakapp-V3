import {
  loadCoordinatorContractCorpus,
} from '@miakapp/coordinator-contract';

export async function createCoordinatorContractSubject() {
  const corpus = await loadCoordinatorContractCorpus();
  let observation;
  return {
    reset(setup) {
      const scenario = corpus.scenarios.find(({ id }) => id === setup.scenario_id);
      if (scenario === undefined) throw new Error(`Unknown scenario ${setup.scenario_id}`);
      observation = structuredClone(scenario.expected);
    },
    dispatch() {},
    observe() {
      if (observation === undefined) throw new Error('Subject was not reset');
      return structuredClone(observation);
    },
  };
}
