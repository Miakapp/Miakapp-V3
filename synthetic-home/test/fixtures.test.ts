import { describe, expect, test } from 'bun:test';
import {
  FIXTURE_LIMITS,
  FixtureViolation,
  validateHome,
  validateJsonValue,
  validateManifest,
  validateScenarioCorpus,
  validateUtcTimestamp,
} from '../src/contract.js';
import { loadSyntheticHomeCorpus, validateCorpusDocuments } from '../src/corpus.js';

const corpus = await loadSyntheticHomeCorpus();

describe('synthetic-home corpus', () => {
  test('loads one immutable, explicitly synthetic corpus', () => {
    expect(corpus.manifest).toMatchObject({
      fixture_version: 1,
      provenance: {
        kind: 'hand_authored_synthetic',
        derived_from_export: false,
        contains_production_data: false,
        human_review_required: true,
      },
    });
    expect(corpus.home.home_id).toBe(corpus.scenarios.home_id);
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus.home.actors[0])).toBe(true);
  });

  test('covers every required behavior class', () => {
    const covered = new Set(corpus.scenarios.scenarios.flatMap(({ coverage }) => coverage));
    expect([...corpus.manifest.required_coverage].sort()).toEqual([...covered].sort());
  });

  test('contains the full replay vocabulary', () => {
    const stimulusKinds = new Set(
      corpus.scenarios.scenarios.flatMap(({ stimuli }) => stimuli.map(({ kind }) => kind)),
    );
    expect([...stimulusKinds].sort()).toEqual(['action', 'event', 'lifecycle', 'timer']);
    expect(corpus.scenarios.scenarios.some(({ expected }) => (
      expected.recorded_commands.length > 0
    ))).toBe(true);
    expect(corpus.scenarios.scenarios.some(({ expected }) => (
      expected.notification_intents.length > 0
    ))).toBe(true);
    expect(corpus.scenarios.scenarios.every(({ expected }) => (
      expected.unchanged_paths.length > 0
    ))).toBe(true);
  });

  test('loads deterministically', async () => {
    expect(await loadSyntheticHomeCorpus()).toEqual(corpus);
  });

  test('rejects unknown contract fields', () => {
    expect(() => validateManifest({ ...corpus.manifest, extra: true })).toThrow(FixtureViolation);
  });

  test('rejects sparse arrays', () => {
    const home = structuredClone(corpus.home) as unknown as Record<string, unknown>;
    home.actors = new Array(1);
    expect(() => validateHome(home)).toThrow(/dense array/);
  });

  test('rejects reserved prototype keys at nested levels', () => {
    const manifest = structuredClone(corpus.manifest) as unknown as Record<string, unknown>;
    const provenance = structuredClone(corpus.manifest.provenance);
    Object.defineProperty(provenance, '__proto__', { value: {}, enumerable: true });
    manifest.provenance = provenance;
    expect(() => validateManifest(manifest)).toThrow(/forbidden key/);
  });

  test('rejects text beyond the fixture byte limit', () => {
    const scenarios = structuredClone(corpus.scenarios);
    scenarios.scenarios[0]!.description = 'x'.repeat(FIXTURE_LIMITS.descriptionBytes + 1);
    expect(() => validateScenarioCorpus(scenarios)).toThrow(/exceeds/);
  });

  test('rejects normalized but impossible calendar timestamps', () => {
    expect(() => validateUtcTimestamp('2042-02-31T06:00:00Z')).toThrow(/RFC 3339/);
  });

  test('rejects non-canonical or lossy JSON numbers', () => {
    expect(() => validateJsonValue(-0)).toThrow(/canonical JSON number/);
    expect(() => validateJsonValue(Number.MAX_SAFE_INTEGER + 1)).toThrow(/canonical JSON number/);
    expect(() => validateManifest({ ...corpus.manifest, seed: -0 })).toThrow(/non-negative/);
  });

  test('rejects undeclared references', () => {
    const home = structuredClone(corpus.home);
    home.actors[0]!.groups.push('syn_group_missing');
    expect(() => validateCorpusDocuments(corpus.manifest, home, corpus.scenarios)).toThrow(
      /unknown group/,
    );
  });

  test('rejects ambiguous legacy action element identifiers', () => {
    const home = structuredClone(corpus.home);
    home.actions[1]!.element_id = home.actions[0]!.element_id;
    expect(() => validateHome(home)).toThrow(/duplicate element_id/);
  });

  test('rejects state values that disagree with their declaration', () => {
    const home = structuredClone(corpus.home);
    home.initial_state['zone.alpha.contact.open'] = 'not_a_boolean';
    expect(() => validateCorpusDocuments(corpus.manifest, home, corpus.scenarios)).toThrow(
      /does not match boolean/,
    );
  });

  test('rejects undeclared context flow IDs and keys', () => {
    const unknownFlow = structuredClone(corpus.scenarios);
    unknownFlow.scenarios[0]!.setup.context.flows.syn_flow_typo = { value: true };
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, unknownFlow)).toThrow(
      /syn_flow_typo is not declared/,
    );

    const unknownKey = structuredClone(corpus.scenarios);
    unknownKey.scenarios[0]!.setup.context.flows.syn_flow_entry!['entry.typo'] = true;
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, unknownKey)).toThrow(
      /entry\.typo is not declared/,
    );
  });

  test('rejects arrays where a declared object event requires a record', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_energy_period')!;
    const stimulus = scenario.stimuli.find((candidate) => (
      candidate.kind === 'event' && candidate.name === 'energy.grid.sample'
    ));
    if (stimulus?.kind !== 'event') throw new Error('energy sample stimulus is missing');
    stimulus.value = [];
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /wrong value type/,
    );
  });

  test('requires executable evidence for every coverage label', () => {
    const scenarios = structuredClone(corpus.scenarios);
    scenarios.scenarios = [scenarios.scenarios[0]!];
    scenarios.scenarios[0]!.coverage = [...corpus.manifest.required_coverage];
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /does not demonstrate declared coverage sensor_automation/,
    );
  });

  test('requires every toggle action to be declared non-idempotent', () => {
    expect(corpus.home.actions.filter(({ name }) => name.endsWith('.toggle')).every((action) => (
      action.idempotency === 'non_idempotent'
    ))).toBe(true);
    const home = structuredClone(corpus.home);
    home.actions.find(({ name }) => name === 'lighting.toggle')!.idempotency = 'idempotent';
    expect(() => validateCorpusDocuments(corpus.manifest, home, corpus.scenarios)).toThrow(
      /must be non-idempotent/,
    );
  });

  test('rejects an oracle that grants a group-protected action to an observer', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_action_denied')!;
    scenario.expected.operations = [
      { operation_id: 'syn_op_denied', status: 'accepted' },
      { operation_id: 'syn_op_denied', status: 'applied' },
    ];
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /does not preserve group authorization/,
    );
  });

  test('rejects side effects from a denied-only action scenario', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_action_denied')!;
    scenario.expected.state_patch['zone.alpha.light.on'] = true;
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /denied-only actions must not produce side effects/,
    );
  });

  test('rejects action commands disguised as stimulus effects', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_action_denied')!;
    scenario.expected.recorded_commands.push({
      target_id: 'syn_barrier_beta',
      name: 'barrier.motion',
      value: 'open',
      cause: { kind: 'stimulus', stimulus_index: 0 },
    });
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /action commands must use operation provenance/,
    );
  });

  test('requires command provenance in the closed fixture schema', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_entry_automation')!;
    const command = scenario.expected.recorded_commands[0]! as unknown as Record<string, unknown>;
    delete command.cause;
    expect(() => validateScenarioCorpus(scenarios)).toThrow(/cause is required/);
  });

  test('rejects a recorded command outside the target device capabilities', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_climate_setpoint')!;
    scenario.expected.recorded_commands[0]!.name = 'barrier.motion';
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /is not a capability/,
    );
  });

  test('keeps non-idempotent failure explicit and non-retried', () => {
    const scenario = corpus.scenarios.scenarios.find(({ id }) => (
      id === 'syn_scenario_outcome_unknown'
    ));
    expect(scenario).toBeDefined();
    expect(scenario!.expected.operations.map(({ status }) => status)).toEqual([
      'accepted',
      'outcome_unknown',
    ]);
    expect(scenario!.expected.recorded_commands).toHaveLength(1);
    expect(scenario!.expected.unchanged_paths).toContain('service.coordinator.last_restart');
  });

  test('rejects a retry hidden behind unrelated stimulus provenance', () => {
    const scenarios = structuredClone(corpus.scenarios);
    const scenario = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_outcome_unknown')!;
    scenario.expected.recorded_commands.push({
      target_id: 'syn_service_alpha',
      name: 'service.restart',
      value: true,
      cause: { kind: 'stimulus', stimulus_index: 1 },
    });
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, scenarios)).toThrow(
      /must not be retried/,
    );
  });

  test('rejects lifecycle observations not declared by the home', () => {
    const home = structuredClone(corpus.home);
    home.lifecycle_signals = home.lifecycle_signals.filter((signal) => signal !== 'disconnect');
    const scenarios = structuredClone(corpus.scenarios);
    const bootstrap = scenarios.scenarios.find(({ id }) => id === 'syn_scenario_bootstrap')!;
    bootstrap.expected.lifecycle = [{ signal: 'disconnect' }];
    expect(() => validateCorpusDocuments(corpus.manifest, home, scenarios)).toThrow(
      /emits undeclared lifecycle signal disconnect/,
    );
  });

  test('rejects unknown or notification-disabled actor audiences', () => {
    const unknownActor = structuredClone(corpus.scenarios);
    const unknownIntent = unknownActor.scenarios.find(({ id }) => (
      id === 'syn_scenario_low_battery'
    ))!.expected.notification_intents[0]!;
    unknownIntent.audience.groups = [];
    unknownIntent.audience.actors = ['syn_actor_missing'];
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, unknownActor)).toThrow(
      /notification uses unknown actor syn_actor_missing/,
    );

    const disabledActor = structuredClone(corpus.scenarios);
    const disabledIntent = disabledActor.scenarios.find(({ id }) => (
      id === 'syn_scenario_low_battery'
    ))!.expected.notification_intents[0]!;
    disabledIntent.audience.groups = [];
    disabledIntent.audience.actors = ['syn_actor_guest'];
    expect(() => validateCorpusDocuments(corpus.manifest, corpus.home, disabledActor)).toThrow(
      /targets actor syn_actor_guest with notifications disabled/,
    );
  });
});
