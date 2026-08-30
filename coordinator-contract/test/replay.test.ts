import { describe, expect, test } from 'bun:test';
import {
  ContractCancelled,
  ContractDivergence,
  ContractTimeout,
  type CoordinatorContractCorpus,
  type CoordinatorContractSubject,
  type ContractObservation,
  loadCoordinatorContractCorpus,
  replayContractCorpus,
  replayContractScenario,
} from '../src/index.js';

const corpus = await loadCoordinatorContractCorpus();

class ExpectedSubject implements CoordinatorContractSubject {
  #corpus: CoordinatorContractCorpus;
  #observation?: ContractObservation;
  #transform: (value: ContractObservation) => ContractObservation;

  constructor(
    source: CoordinatorContractCorpus,
    transform: (value: ContractObservation) => ContractObservation = (value) => value,
  ) {
    this.#corpus = source;
    this.#transform = transform;
  }

  reset(setup: { scenario_id: string }, _signal: AbortSignal): void {
    const scenario = this.#corpus.scenarios.find(({ id }) => id === setup.scenario_id);
    if (scenario === undefined) throw new Error(`missing ${setup.scenario_id}`);
    this.#observation = structuredClone(scenario.expected);
  }

  dispatch(): void {}

  observe(): ContractObservation {
    if (this.#observation === undefined) throw new Error('subject was not reset');
    return this.#transform(structuredClone(this.#observation));
  }
}

describe('coordinator contract replay', () => {
  test('replays the complete corpus deterministically', async () => {
    const first = await replayContractCorpus(corpus, new ExpectedSubject(corpus));
    const second = await replayContractCorpus(corpus, new ExpectedSubject(corpus));
    expect(first).toHaveLength(corpus.scenarios.length);
    expect(second).toEqual(first);
  });

  test('preserves ordered stimuli', async () => {
    const kinds: string[] = [];
    const expected = new ExpectedSubject(corpus);
    const subject: CoordinatorContractSubject = {
      reset: (...args) => expected.reset(...args),
      dispatch(stimulus) { kinds.push(stimulus.kind); },
      observe: () => expected.observe(),
    };
    await replayContractScenario(corpus, 'sdk_startup_barrier', subject);
    expect(kinds).toEqual([
      'start',
      'welcome',
      'declaration_ack',
      'declaration_probe',
      'declaration_ack',
      'declaration_probe',
      'declaration_ack',
      'declaration_probe',
      'declaration_ack',
      'declaration_handoff',
      'declaration_probe',
      'declaration_ack',
      'declaration_probe',
    ]);
  });

  test('reports the first exact divergence', async () => {
    const subject = new ExpectedSubject(corpus, (observation) => ({
      ...observation,
      resources: { ...observation.resources, sockets: 2 },
    }));
    await expect(replayContractScenario(
      corpus,
      'sdk_inert_construction',
      subject,
    )).rejects.toMatchObject({
      name: 'ContractDivergence',
      path: '$.resources.sockets',
      expected: 0,
      actual: 2,
    });
  });

  test('uses the dedicated divergence error', () => {
    const error = new ContractDivergence('sdk_example', {
      path: '$.example',
      expected: true,
      actual: false,
    });
    expect(error.message).toContain('sdk_example');
  });

  test('bounds a hook that never settles and aborts its work signal', async () => {
    let workSignal: AbortSignal | undefined;
    const subject: CoordinatorContractSubject = {
      reset: (_setup, signal) => {
        workSignal = signal;
        return new Promise<void>(() => undefined);
      },
      dispatch: () => undefined,
      observe: () => ({}),
    };
    await expect(replayContractScenario(
      corpus,
      'sdk_inert_construction',
      subject,
      { hookTimeoutMs: 10 },
    )).rejects.toBeInstanceOf(ContractTimeout);
    expect(workSignal?.aborted).toBe(true);
    expect(workSignal?.reason).toBeInstanceOf(ContractTimeout);
  });

  test('rejects repeated progress references returned by a subject', async () => {
    const subject = new ExpectedSubject(corpus, (observation) => {
      const sharedProgress = { stage: 'shared' };
      observation.call_streams[0]!.progress = [sharedProgress, sharedProgress];
      return observation;
    });
    await expect(replayContractScenario(
      corpus,
      'sdk_call_streaming',
      subject,
    )).rejects.toMatchObject({
      name: 'ContractViolation',
      code: 'invalid_value',
    });
  });

  test('keeps observation validation inside the cancellation boundary', async () => {
    const controller = new AbortController();
    const subject = new ExpectedSubject(corpus, (observation) => {
      const statuses = observation.statuses;
      Object.defineProperty(observation, 'statuses', {
        configurable: true,
        enumerable: true,
        get() {
          controller.abort();
          return statuses;
        },
      });
      return observation;
    });
    await expect(replayContractScenario(
      corpus,
      'sdk_inert_construction',
      subject,
      { signal: controller.signal },
    )).rejects.toMatchObject({
      name: 'ContractCancelled',
      stage: 'observe',
    });
  });

  test('honors parent cancellation before invoking a hook', async () => {
    const controller = new AbortController();
    controller.abort();
    let resets = 0;
    const subject: CoordinatorContractSubject = {
      reset: () => { resets += 1; },
      dispatch: () => undefined,
      observe: () => ({}),
    };
    await expect(replayContractScenario(
      corpus,
      'sdk_inert_construction',
      subject,
      { signal: controller.signal },
    )).rejects.toBeInstanceOf(ContractCancelled);
    expect(resets).toBe(0);
  });
});
