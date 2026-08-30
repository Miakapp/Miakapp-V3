import {
  loadCoordinatorContractCorpus,
} from '@miakapp/coordinator-contract';

const waitCell = new Int32Array(new SharedArrayBuffer(4));

function hangAt(stage) {
  if (process.env.MIAKAPP_TEST_HANG_STAGE === stage) {
    Atomics.wait(waitCell, 0, 0);
  }
}

hangAt('import');

export async function createCoordinatorContractSubject() {
  hangAt('factory');
  const corpus = await loadCoordinatorContractCorpus();
  let observation;
  return {
    reset(setup) {
      hangAt('reset');
      const scenario = corpus.scenarios.find(({ id }) => id === setup.scenario_id);
      if (scenario === undefined) throw new Error(`Unknown scenario ${setup.scenario_id}`);
      observation = structuredClone(scenario.expected);
    },
    dispatch() {
      hangAt('dispatch');
    },
    observe() {
      hangAt('observe');
      if (observation === undefined) throw new Error('Subject was not reset');
      return structuredClone(observation);
    },
  };
}
