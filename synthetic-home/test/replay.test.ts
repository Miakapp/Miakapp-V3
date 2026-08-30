import { describe, expect, test } from 'bun:test';
import type {
  FixtureContext,
  ReplayObservation,
  ScenarioStimulus,
  SyntheticScenario,
} from '../src/contract.js';
import { FixtureViolation } from '../src/contract.js';
import { loadSyntheticHomeCorpus, type SyntheticHomeCorpus } from '../src/corpus.js';
import {
  ReplayCancelled,
  ReplayDivergence,
  ReplayTimeout,
  replayCorpus,
  replayScenario,
  type ReplaySetup,
  type ReplaySubject,
} from '../src/replay.js';

const corpus = await loadSyntheticHomeCorpus();

function mergeContext(base: FixtureContext, patch: FixtureContext): FixtureContext {
  const flows: FixtureContext['flows'] = {};
  for (const flowId of new Set([...Object.keys(base.flows), ...Object.keys(patch.flows)])) {
    flows[flowId] = { ...(base.flows[flowId] ?? {}), ...(patch.flows[flowId] ?? {}) };
  }
  return { global: { ...base.global, ...patch.global }, flows };
}

class ExpectedSubject implements ReplaySubject {
  readonly setups: ReplaySetup[] = [];
  readonly stimuli = new Map<string, ScenarioStimulus[]>();
  private current: SyntheticScenario | undefined;
  private setup: ReplaySetup | undefined;

  constructor(
    private readonly source: SyntheticHomeCorpus,
    private readonly transform: (
      observation: ReplayObservation,
      scenario: SyntheticScenario,
    ) => unknown = (observation) => observation,
  ) {}

  reset(setup: ReplaySetup): void {
    this.current = this.source.scenarios.scenarios.find(({ id }) => id === setup.scenario_id);
    if (this.current === undefined) throw new Error(`Unknown scenario ${setup.scenario_id}`);
    this.setup = structuredClone(setup);
    this.setups.push(structuredClone(this.setup));
    this.stimuli.set(setup.scenario_id, []);
    setup.home.home_id = 'syn_home_subject_copy';
  }

  dispatch(stimulus: ScenarioStimulus): void {
    if (this.current === undefined) throw new Error('Subject is not reset');
    this.stimuli.get(this.current.id)!.push(structuredClone(stimulus));
  }

  observe(): unknown {
    if (this.current === undefined || this.setup === undefined) throw new Error('Subject is not reset');
    const observation: ReplayObservation = {
      state: { ...this.setup.state, ...this.current.expected.state_patch },
      context: mergeContext(this.setup.context, this.current.expected.context_patch),
      recorded_commands: structuredClone(this.current.expected.recorded_commands),
      notification_intents: structuredClone(this.current.expected.notification_intents),
      lifecycle: structuredClone(this.current.expected.lifecycle),
      operations: structuredClone(this.current.expected.operations),
    };
    return this.transform(observation, this.current);
  }
}

describe('synthetic-home replay', () => {
  test('replays the complete corpus against a subject-neutral interface', async () => {
    const subject = new ExpectedSubject(corpus);
    const results = await replayCorpus(corpus, subject);
    expect(results).toHaveLength(corpus.scenarios.scenarios.length);
    expect(results.every(({ stimuli_dispatched }) => stimuli_dispatched > 0)).toBe(true);
    expect(subject.setups.every(({ clock }) => clock === '2042-04-05T06:00:00Z')).toBe(true);
    expect(subject.setups.every(({ seed }) => seed === corpus.manifest.seed)).toBe(true);
    expect(corpus.home.home_id).toBe('syn_home_aster');
  });

  test('merges initial state and scenario setup before reset', async () => {
    const subject = new ExpectedSubject(corpus);
    await replayScenario(corpus, 'syn_scenario_barrier_busy', subject);
    expect(subject.setups[0]!.state).toMatchObject({
      'zone.alpha.light.on': false,
      'access.barrier.phase': 'opening',
      'access.barrier.position': 40,
    });
    expect(subject.setups[0]!.context.flows.syn_flow_barrier).toMatchObject({
      'barrier.phase': 'opening',
      'barrier.busy': true,
      'barrier.last_operation': null,
    });
  });

  test('preserves stimulus order', async () => {
    const subject = new ExpectedSubject(corpus);
    await replayScenario(corpus, 'syn_scenario_barrier_complete', subject);
    expect(subject.stimuli.get('syn_scenario_barrier_complete')!.map(({ kind }) => kind)).toEqual([
      'action',
      'event',
      'event',
    ]);
  });

  test('reports the first exact divergence', async () => {
    const subject = new ExpectedSubject(corpus, (observation) => ({
      ...observation,
      state: { ...observation.state, 'system.snapshot.revision': 99 },
    }));
    await expect(replayScenario(corpus, 'syn_scenario_bootstrap', subject)).rejects.toMatchObject({
      name: 'ReplayDivergence',
      scenarioId: 'syn_scenario_bootstrap',
      path: '$.state.system.snapshot.revision',
      expected: 2,
      actual: 99,
    });
  });

  test('independently detects mutation of a protected state path', async () => {
    const subject = new ExpectedSubject(corpus, (observation) => ({
      ...observation,
      state: { ...observation.state, 'access.barrier.phase': 'open' },
    }));
    await expect(replayScenario(corpus, 'syn_scenario_bootstrap', subject)).rejects.toMatchObject({
      name: 'ReplayDivergence',
      path: '$.state.access.barrier.phase',
      expected: 'closed',
      actual: 'open',
    });
  });

  test('rejects malformed subject observations before comparison', async () => {
    const subject: ReplaySubject = {
      reset: () => undefined,
      dispatch: () => undefined,
      observe: () => ({}),
    };
    await expect(replayScenario(corpus, 'syn_scenario_bootstrap', subject)).rejects.toBeInstanceOf(
      FixtureViolation,
    );
  });

  test('produces the same results on repeated runs', async () => {
    const first = await replayCorpus(corpus, new ExpectedSubject(corpus));
    const second = await replayCorpus(corpus, new ExpectedSubject(corpus));
    expect(second).toEqual(first);
  });

  test('bounds a hook that never settles and aborts its work signal', async () => {
    let workSignal: AbortSignal | undefined;
    const subject: ReplaySubject = {
      reset: (_setup, signal) => {
        workSignal = signal;
        return new Promise<void>(() => undefined);
      },
      dispatch: () => undefined,
      observe: () => ({}),
    };
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      subject,
      { hookTimeoutMs: 10 },
    )).rejects.toMatchObject({
      name: 'ReplayTimeout',
      scenarioId: 'syn_scenario_bootstrap',
      stage: 'reset',
      timeoutMs: 10,
    });
    expect(workSignal?.aborted).toBe(true);
    expect(workSignal?.reason).toBeInstanceOf(ReplayTimeout);
  });

  test('honors a parent cancellation before invoking a subject hook', async () => {
    const controller = new AbortController();
    controller.abort();
    let resets = 0;
    const subject: ReplaySubject = {
      reset: () => { resets += 1; },
      dispatch: () => undefined,
      observe: () => ({}),
    };
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      subject,
      { signal: controller.signal },
    )).rejects.toBeInstanceOf(ReplayCancelled);
    expect(resets).toBe(0);
  });

  test('propagates parent cancellation to a hook already in progress', async () => {
    const controller = new AbortController();
    let workSignal: AbortSignal | undefined;
    const subject: ReplaySubject = {
      reset: (_setup, signal) => {
        workSignal = signal;
        return new Promise<void>(() => undefined);
      },
      dispatch: () => undefined,
      observe: () => ({}),
    };
    const replay = replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      subject,
      { signal: controller.signal },
    );
    queueMicrotask(() => controller.abort());
    await expect(replay).rejects.toBeInstanceOf(ReplayCancelled);
    expect(workSignal?.aborted).toBe(true);
    expect(workSignal?.reason).toBeInstanceOf(ReplayCancelled);
  });

  test('uses a dedicated divergence error', () => {
    const error = new ReplayDivergence('syn_scenario_example', {
      path: '$.example',
      expected: true,
      actual: false,
    });
    expect(error.message).toContain('syn_scenario_example');
  });
});
