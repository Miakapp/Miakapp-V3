import {
  loadCoordinatorContractCorpus,
} from '@miakapp/coordinator-contract';

function exitAt(stage) {
  if (process.env.MIAKAPP_TEST_EXIT_STAGE === stage) process.exit(0);
}

exitAt('import');

export async function createCoordinatorContractSubject() {
  exitAt('factory');
  const corpus = await loadCoordinatorContractCorpus();
  let observation;
  return {
    reset(setup) {
      exitAt('reset');
      const scenario = corpus.scenarios.find(({ id }) => id === setup.scenario_id);
      if (scenario === undefined) throw new Error(`Unknown scenario ${setup.scenario_id}`);
      observation = structuredClone(scenario.expected);
    },
    dispatch() {
      exitAt('dispatch');
    },
    observe() {
      exitAt('observe');
      if (observation === undefined) throw new Error('Subject was not reset');
      return structuredClone(observation);
    },
  };
}
