import { describe, expect, test } from 'bun:test';
import {
  type FixtureContext,
  type JsonValue,
  type ReplayObservation,
  type ReplaySetup,
  type ScenarioStimulus,
  loadSyntheticHomeCorpus,
  replayCorpus,
  replayScenario,
} from '@miakapp/synthetic-home-conformance';
import {
  CapabilityLeaseExpired,
  type MigrationAdapterSubject,
  type MigrationCapabilities,
  MissingStatePublication,
  RecordingEffectSink,
  StatePublicationDisabled,
  UnclassifiedEffect,
  createMigrationReplayHarness,
} from '../src/index.js';

const corpus = await loadSyntheticHomeCorpus();

function mergeContext(base: FixtureContext, patch: FixtureContext): FixtureContext {
  const flows: Record<string, Record<string, JsonValue>> = {};
  for (const flowId of new Set([...Object.keys(base.flows), ...Object.keys(patch.flows)])) {
    flows[flowId] = { ...(base.flows[flowId] ?? {}), ...(patch.flows[flowId] ?? {}) };
  }
  return { global: { ...base.global, ...patch.global }, flows };
}

class ExpectedMigrationAdapter implements MigrationAdapterSubject {
  protected setup: ReplaySetup | undefined;
  protected scenario: (typeof corpus.scenarios.scenarios)[number] | undefined;
  protected capabilities: MigrationCapabilities | undefined;
  protected dispatched = 0;
  readonly selfAttestEffects: boolean;

  constructor(selfAttestEffects = false) {
    this.selfAttestEffects = selfAttestEffects;
  }

  reset(
    setup: ReplaySetup,
    capabilities: MigrationCapabilities,
    _signal: AbortSignal,
  ): void {
    this.setup = setup;
    this.scenario = corpus.scenarios.scenarios.find(({ id }) => id === setup.scenario_id);
    this.capabilities = capabilities;
    this.dispatched = 0;
    if (this.scenario === undefined) throw new Error(`missing ${setup.scenario_id}`);
  }

  async dispatch(
    _stimulus: ScenarioStimulus,
    _capabilities: MigrationCapabilities,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.setup === undefined || this.scenario === undefined || this.capabilities === undefined) {
      throw new Error('adapter was not reset');
    }
    this.dispatched += 1;
    if (this.dispatched !== this.scenario.stimuli.length) return;
    if (!this.selfAttestEffects) {
      for (const command of this.scenario.expected.recorded_commands) {
        this.capabilities.effects.record({ kind: 'device_command', command });
      }
      for (const intent of this.scenario.expected.notification_intents) {
        this.capabilities.effects.record({ kind: 'notification_intent', intent });
      }
    }
    if (this.capabilities.mode !== 'observe') {
      await this.capabilities.state.publish({
        ...this.setup.state,
        ...this.scenario.expected.state_patch,
      }, signal);
    }
  }

  observe(_signal: AbortSignal): ReplayObservation {
    if (this.setup === undefined || this.scenario === undefined) throw new Error('adapter was not reset');
    return {
      state: { ...this.setup.state, ...this.scenario.expected.state_patch },
      context: mergeContext(this.setup.context, this.scenario.expected.context_patch),
      recorded_commands: this.selfAttestEffects
        ? structuredClone(this.scenario.expected.recorded_commands)
        : [],
      notification_intents: this.selfAttestEffects
        ? structuredClone(this.scenario.expected.notification_intents)
        : [],
      lifecycle: structuredClone(this.scenario.expected.lifecycle),
      operations: structuredClone(this.scenario.expected.operations),
    };
  }
}

describe('migration replay harness', () => {
  test('replays every synthetic behavior using recorder-owned effects', async () => {
    const harness = createMigrationReplayHarness(
      new ExpectedMigrationAdapter(),
      'recorded_action',
    );
    const results = await replayCorpus(corpus, harness.subject);
    expect(results).toHaveLength(corpus.scenarios.scenarios.length);
    expect(results.some(({ observation }) => observation.recorded_commands.length > 0)).toBe(true);
    expect(results.some(({ observation }) => observation.notification_intents.length > 0)).toBe(true);
  });

  test('does not trust an adapter that self-attests its effects', async () => {
    const harness = createMigrationReplayHarness(
      new ExpectedMigrationAdapter(true),
      'recorded_action',
    );
    await expect(replayScenario(
      corpus,
      'syn_scenario_low_battery',
      harness.subject,
    )).rejects.toMatchObject({
      name: 'ReplayDivergence',
      path: '$.notification_intents.length',
      expected: 1,
      actual: 0,
    });
  });

  test('disables state publication in observe mode', async () => {
    const adapter = new ExpectedMigrationAdapter();
    const publishing: MigrationAdapterSubject = {
      reset: async (setup, capabilities, signal) => {
        adapter.reset(setup, capabilities, signal);
        await capabilities.state.publish(setup.state, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(publishing, 'observe');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toBeInstanceOf(StatePublicationDisabled);
  });

  test('records state publication without supplying a live effect sink', async () => {
    const adapter = new ExpectedMigrationAdapter();
    let keys: string[] = [];
    let frozen = false;
    const publishing: MigrationAdapterSubject = {
      reset: async (setup, capabilities, signal) => {
        keys = Object.keys(capabilities).sort();
        frozen = Object.isFrozen(capabilities);
        adapter.reset(setup, capabilities, signal);
        await capabilities.state.publish(setup.state, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(publishing, 'shadow_state');
    await replayScenario(corpus, 'syn_scenario_bootstrap', harness.subject);
    expect(harness.state.evidence().publicationCount).toBeGreaterThanOrEqual(1);
    expect(keys).toEqual(['effects', 'mode', 'state']);
    expect(frozen).toBe(true);
  });

  test('exposes frozen write-only capability facades', async () => {
    const adapter = new ExpectedMigrationAdapter();
    let effectKeys: string[] = [];
    let stateKeys: string[] = [];
    let nestedFrozen = false;
    const inspecting: MigrationAdapterSubject = {
      reset: (setup, capabilities, signal) => {
        effectKeys = Object.keys(capabilities.effects).sort();
        stateKeys = Object.keys(capabilities.state).sort();
        nestedFrozen = Object.isFrozen(capabilities.effects) && Object.isFrozen(capabilities.state);
        adapter.reset(setup, capabilities, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(inspecting, 'recorded_action');
    await replayScenario(corpus, 'syn_scenario_bootstrap', harness.subject);
    expect(effectKeys).toEqual(['record']);
    expect(stateKeys).toEqual(['publish']);
    expect(nestedFrozen).toBe(true);
  });

  test('revokes a capability lease before the observation checkpoint', async () => {
    const adapter = new ExpectedMigrationAdapter();
    let capabilities: MigrationCapabilities | undefined;
    const capturing: MigrationAdapterSubject = {
      reset: (setup, supplied, signal) => {
        capabilities = supplied;
        adapter.reset(setup, supplied, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(capturing, 'recorded_action');
    await replayScenario(corpus, 'syn_scenario_bootstrap', harness.subject);

    const command = corpus.scenarios.scenarios
      .flatMap(({ expected }) => expected.recorded_commands)[0]!;
    const lateError = await new Promise<unknown>((resolve) => {
      setTimeout(() => {
        try {
          capabilities!.effects.record({ kind: 'device_command', command });
          resolve(undefined);
        } catch (error) {
          resolve(error);
        }
      }, 0);
    });
    expect(lateError).toBeInstanceOf(CapabilityLeaseExpired);
    expect(harness.effects.snapshot()).toEqual({
      recorded_commands: [],
      notification_intents: [],
    });
  });

  test('revokes the previous lease before resetting recorder state', async () => {
    const supplied: MigrationCapabilities[] = [];
    const adapter: MigrationAdapterSubject = {
      reset: (_setup, capabilities) => {
        supplied.push(capabilities);
      },
      dispatch: () => undefined,
      observe: () => ({
        state: {},
        context: { global: {}, flows: {} },
        recorded_commands: [],
        notification_intents: [],
        lifecycle: [],
        operations: [],
      }),
    };
    const harness = createMigrationReplayHarness(adapter, 'observe');
    const signal = new AbortController().signal;
    const setup = {
      scenario_id: 'syn_scenario_bootstrap',
      seed: corpus.manifest.seed,
      clock: corpus.manifest.clock.start,
      connection: 'connected' as const,
      home: structuredClone(corpus.home),
      state: structuredClone(corpus.home.initial_state),
      context: structuredClone(corpus.home.initial_context),
    };

    await harness.subject.reset(setup, signal);
    await harness.subject.reset(setup, signal);
    expect(supplied).toHaveLength(2);
    expect(() => supplied[0]!.effects.record({ kind: 'shell' })).toThrow(
      CapabilityLeaseExpired,
    );
    expect(() => supplied[1]!.effects.record({ kind: 'shell' })).toThrow(
      UnclassifiedEffect,
    );
  });

  test('rejects an array disguised as a state publication', async () => {
    const adapter = new ExpectedMigrationAdapter();
    const publishing: MigrationAdapterSubject = {
      reset: async (setup, capabilities, signal) => {
        adapter.reset(setup, capabilities, signal);
        await capabilities.state.publish([] as never, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(publishing, 'shadow_state');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toBeInstanceOf(TypeError);
  });

  test('rejects an unclassified effect at the recorder boundary', () => {
    const effects = new RecordingEffectSink();
    expect(() => effects.record({ kind: 'shell', command: 'toggle' })).toThrow(
      UnclassifiedEffect,
    );
    expect(effects.snapshot()).toEqual({
      recorded_commands: [],
      notification_intents: [],
    });
  });

  test('does not retain or serialize a rejected effect payload', () => {
    const effects = new RecordingEffectSink();
    const payload = { kind: 'http_request', authorization: 'Bearer synthetic-secret' };
    try {
      effects.record(payload);
      throw new Error('expected an unclassified effect');
    } catch (error) {
      expect(error).toBeInstanceOf(UnclassifiedEffect);
      expect(JSON.stringify(error)).not.toContain('synthetic-secret');
      expect(Object.keys(error as object)).toEqual(['code', 'name']);
    }
  });

  test('bounds aggregate effect evidence by bytes as well as count', () => {
    const effects = new RecordingEffectSink();
    const largeValue = Array.from(
      { length: 200 },
      () => Array.from({ length: 19 }, () => 'x'.repeat(1_024)),
    );
    expect(() => effects.record({
      kind: 'device_command',
      command: {
        target_id: 'syn_device_alpha',
        name: 'device.command',
        value: largeValue,
        cause: { kind: 'stimulus', stimulus_index: 0 },
      },
    })).toThrow(/byte budget/);
    expect(effects.snapshot()).toEqual({
      recorded_commands: [],
      notification_intents: [],
    });
  });

  test('requires recorder-owned state evidence in publishing modes', async () => {
    const adapter = new ExpectedMigrationAdapter();
    const silent: MigrationAdapterSubject = {
      reset: (...args) => adapter.reset(...args),
      dispatch: () => undefined,
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(silent, 'shadow_state');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toBeInstanceOf(MissingStatePublication);
  });

  test('compares the recorder-owned final state instead of a self-attested state', async () => {
    const adapter = new ExpectedMigrationAdapter();
    const stale: MigrationAdapterSubject = {
      reset: (...args) => adapter.reset(...args),
      dispatch: async (stimulus, capabilities, signal) => {
        await adapter.dispatch(stimulus, capabilities, signal);
        await capabilities.state.publish({ 'system.connection.status': 'stale' }, signal);
      },
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(stale, 'shadow_state');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toMatchObject({ name: 'ReplayDivergence' });
  });

  test('rejects malformed published state paths', async () => {
    const adapter = new ExpectedMigrationAdapter();
    const malformed: MigrationAdapterSubject = {
      reset: async (setup, capabilities, signal) => {
        adapter.reset(setup, capabilities, signal);
        await capabilities.state.publish({ 'not a state path': true }, signal);
      },
      dispatch: (...args) => adapter.dispatch(...args),
      observe: (...args) => adapter.observe(...args),
    };
    const harness = createMigrationReplayHarness(malformed, 'shadow_state');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toThrow(/state path/);
  });

  test('propagates fail-closed effect rejection through replay', async () => {
    const expected = new ExpectedMigrationAdapter();
    const hostile: MigrationAdapterSubject = {
      reset: (...args) => expected.reset(...args),
      dispatch: (stimulus, capabilities, signal) => {
        capabilities.effects.record({ kind: 'http_request', url: 'https://example.invalid' });
        return expected.dispatch(stimulus, capabilities, signal);
      },
      observe: (...args) => expected.observe(...args),
    };
    const harness = createMigrationReplayHarness(hostile, 'recorded_action');
    await expect(replayScenario(
      corpus,
      'syn_scenario_bootstrap',
      harness.subject,
    )).rejects.toBeInstanceOf(UnclassifiedEffect);
  });
});
