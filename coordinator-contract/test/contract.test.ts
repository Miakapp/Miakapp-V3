import { describe, expect, test } from 'bun:test';
import { assertPublicFixture } from '@miakapp/synthetic-home-conformance';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CONTRACT_COVERAGE,
  CONTRACT_CORPUS_SCHEMA,
  CONTRACT_LIMITS,
  ContractViolation,
  DECLARATION_ORDER,
  MIGRATION_CONTRACT_COVERAGE,
  SDK_CONTRACT_COVERAGE,
  loadCoordinatorContractCorpus,
  selectCoordinatorContractScenarios,
  validateContractObservation,
  validateCoordinatorContractCorpus,
} from '../src/index.js';

const corpus = await loadCoordinatorContractCorpus();

describe('coordinator contract corpus', () => {
  test('loads one immutable, closed v1 corpus', () => {
    expect(corpus.schema).toBe(CONTRACT_CORPUS_SCHEMA);
    expect(corpus.fixture_version).toBe(1);
    expect(corpus.scenarios).toHaveLength(14);
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus.scenarios[0])).toBe(true);
  });

  test('covers every required coordinator and migration behavior', () => {
    expect([...corpus.required_coverage].sort()).toEqual([...CONTRACT_COVERAGE].sort());
    const covered = new Set(corpus.scenarios.flatMap(({ coverage }) => coverage));
    expect([...covered].sort()).toEqual([...CONTRACT_COVERAGE].sort());
  });

  test('separates complete SDK and migration conformance profiles', () => {
    const sdkScenarios = selectCoordinatorContractScenarios(corpus, 'sdk');
    expect(sdkScenarios).toHaveLength(11);
    expect(sdkScenarios.every(({ setup }) => setup.mode === 'sdk')).toBe(true);
    expect([...new Set(sdkScenarios.flatMap(({ coverage }) => coverage))].sort())
      .toEqual([...SDK_CONTRACT_COVERAGE].sort());

    const migrationScenarios = selectCoordinatorContractScenarios(corpus, 'migration');
    expect(migrationScenarios).toHaveLength(3);
    expect(migrationScenarios.every(({ setup }) => setup.mode !== 'sdk')).toBe(true);
    expect([...new Set(migrationScenarios.flatMap(({ coverage }) => coverage))].sort())
      .toEqual([...MIGRATION_CONTRACT_COVERAGE].sort());
    expect(selectCoordinatorContractScenarios(corpus, 'all')).toHaveLength(14);
  });

  test('rejects unknown or incomplete contract profiles', () => {
    expect(() => selectCoordinatorContractScenarios(corpus, 'unsupported' as never)).toThrow(
      expect.objectContaining({ code: 'invalid_profile' }),
    );

    const incomplete = structuredClone(corpus);
    incomplete.scenarios = incomplete.scenarios.filter(
      ({ id }) => id !== 'sdk_presence_cleanup',
    );
    expect(() => selectCoordinatorContractScenarios(incomplete, 'sdk')).toThrow(
      expect.objectContaining({ code: 'missing_coverage' }),
    );
  });

  test('contains only material accepted by the public-fixture privacy policy', () => {
    expect(() => assertPublicFixture(corpus)).not.toThrow();
  });

  test('locks the synchronization barrier order', () => {
    const startup = corpus.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!;
    expect([...startup.setup.desired_declarations]).toEqual([...DECLARATION_ORDER]);
    expect(startup.expected.declarations.map(({ domain }) => domain)).toEqual([...DECLARATION_ORDER]);
    expect(startup.expected.statuses.at(-1)).toBe('ready');
  });

  test('keeps effectful operation attempts at zero or one', () => {
    const attempts = corpus.scenarios.flatMap(({ expected }) => (
      expected.operations.map(({ attempts: value }) => value)
    ));
    expect(attempts.every((value) => value === 0 || value === 1)).toBe(true);
  });

  test('makes post-send uncertainty and event delivery semantics explicit', () => {
    const reconnect = corpus.scenarios.find(({ id }) => id === 'sdk_reconnect_reconciliation')!;
    expect(reconnect.expected.operations).toEqual([
      {
        operation_id: 'sdk_op_state_applied',
        operation: 'state_set',
        attempts: 1,
        outcome: 'applied',
      },
      {
        operation_id: 'sdk_op_state_failed',
        operation: 'state_set',
        attempts: 1,
        outcome: 'failed',
      },
      {
        operation_id: 'sdk_op_state_rejected',
        operation: 'state_set',
        attempts: 1,
        outcome: 'not_dispatched',
      },
      {
        operation_id: 'sdk_op_state_unknown',
        operation: 'state_set',
        attempts: 1,
        outcome: 'outcome_unknown',
      },
      {
        operation_id: 'sdk_op_event_sent',
        operation: 'event',
        attempts: 1,
        outcome: 'sent',
      },
      {
        operation_id: 'sdk_op_call_sent_unknown',
        operation: 'call',
        attempts: 1,
        outcome: 'outcome_unknown',
        idempotency_key: 'sdk_key_reconnect',
      },
      {
        operation_id: 'sdk_op_call_unknown',
        operation: 'call',
        attempts: 1,
        outcome: 'outcome_unknown',
        idempotency_key: null,
      },
    ]);
  });

  test('rejects unknown contract fields', () => {
    expect(() => validateCoordinatorContractCorpus({ ...corpus, extra: true })).toThrow(
      ContractViolation,
    );
  });

  test('rejects unsafe automatic retry evidence', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_reconnect_reconciliation')!;
    const keyedCall = scenario.expected.operations.find(({ operation_id: operationId }) => (
      operationId === 'sdk_op_call_sent_unknown'
    ));
    if (keyedCall === undefined) throw new Error('missing keyed reconnect call');
    expect(keyedCall.idempotency_key).toBe('sdk_key_reconnect');
    keyedCall.attempts = 2;
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(/retries effectful operation/);
  });

  test('rejects a live effect in every non-live migration mode', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_recorded_effects')!;
    scenario.expected.effects[0]!.destination = 'live';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('requires an unclassified effect to fail closed', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_unclassified_effect')!;
    scenario.expected.effects[0]!.destination = 'recorder';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('rejects a declaration trace whose order differs from the public barrier', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!;
    [scenario.stimuli[2], scenario.stimuli[4]] = [
      scenario.stimuli[4]!,
      scenario.stimuli[2]!,
    ];
    [scenario.expected.declarations[0], scenario.expected.declarations[1]] = [
      scenario.expected.declarations[1]!,
      scenario.expected.declarations[0]!,
    ];
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(/barrier order/);
  });

  test('rejects a missing operation trace', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_offline_rejection')!;
    scenario.expected.operations.pop();
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(/every operation stimulus/);
  });

  test('rejects call progress for an unknown operation', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_call_streaming')!;
    const progress = scenario.stimuli.find(({ kind }) => kind === 'call_progress');
    if (progress?.kind !== 'call_progress') throw new Error('missing call progress fixture');
    progress.operation_id = 'sdk_op_missing';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(/unaccepted call/);
  });

  test('rejects a state-publication count that does not match its stimulus', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_shadow_state')!;
    scenario.expected.state_publications = 0;
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(/publication trace count/);
  });

  test('rejects visibility before atomic declaration activation', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!;
    scenario.expected.declaration_visibility[0] = 'desired';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('rejects corrupted or dropped call-stream evidence', () => {
    const corrupted = structuredClone(corpus);
    const scenario = corrupted.scenarios.find(({ id }) => id === 'sdk_call_streaming')!;
    scenario.expected.call_streams[0]!.progress[0] = 26;
    expect(() => validateCoordinatorContractCorpus(corrupted)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );

    const dropped = structuredClone(corpus);
    dropped.scenarios.find(({ id }) => id === 'sdk_call_streaming')!.expected.call_streams = [];
    expect(() => validateCoordinatorContractCorpus(dropped)).toThrow(
      expect.objectContaining({ code: 'missing_trace' }),
    );
  });

  test('keeps a sent call uncertain when transport disconnects before acceptance', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_reconnect_reconciliation')!;
    const operation = scenario.expected.operations.find(({ operation_id: id }) => (
      id === 'sdk_op_call_sent_unknown'
    ))!;
    operation.outcome = 'not_dispatched';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_outcome' }),
    );
  });

  test('settles call handles across offline, sent, accepted, and cancellation paths', () => {
    const offline = corpus.scenarios.find(({ id }) => id === 'sdk_offline_rejection')!;
    expect(offline.expected.call_streams).toEqual([
      {
        operation_id: 'sdk_op_offline_call',
        acceptance: 'rejected',
        progress: [],
        terminal: { kind: 'error', code: 'not_dispatched' },
      },
    ]);

    const reconnect = corpus.scenarios.find(({ id }) => id === 'sdk_reconnect_reconciliation')!;
    expect(reconnect.expected.call_streams.map(({ acceptance, terminal }) => ({
      acceptance,
      terminal,
    }))).toEqual([
      {
        acceptance: 'rejected',
        terminal: { kind: 'error', code: 'outcome_unknown' },
      },
      {
        acceptance: 'resolved',
        terminal: { kind: 'error', code: 'outcome_unknown' },
      },
    ]);

    const cancellation = corpus.scenarios.find(({ id }) => id === 'sdk_call_cancellation')!;
    expect(cancellation.expected.operations.find(({ operation_id: operationId }) => (
      operationId === 'sdk_op_cancel_before_accept'
    ))).toMatchObject({
      operation_id: 'sdk_op_cancel_before_accept',
      outcome: 'not_dispatched',
    });
    expect(cancellation.expected.call_streams.find(({ operation_id: operationId }) => (
      operationId === 'sdk_op_cancel_before_accept'
    ))).toMatchObject({
      acceptance: 'rejected',
      terminal: { kind: 'error', code: 'not_dispatched' },
    });
    expect(cancellation.expected.errors).toContainEqual({
      code: 'not_declared',
      stimulus_index: 9,
      correlation: { kind: 'call', local_id: 'sdk_op_rejected_before_accept' },
    });
    expect(cancellation.expected.errors).toContainEqual({
      code: 'cancelled',
      stimulus_index: 13,
      correlation: { kind: 'call', local_id: 'sdk_op_cancel_before_accept' },
    });
    expect(cancellation.expected.errors).toContainEqual({
      code: 'outcome_unknown',
      stimulus_index: 18,
      correlation: { kind: 'call', local_id: 'sdk_op_cancel' },
    });
  });

  test('requires late event failures to retain their local correlation', () => {
    const scenario = corpus.scenarios.find(({ id }) => id === 'sdk_event_error_correlation')!;
    expect(scenario.stimuli.filter(({ kind }) => kind === 'operation').map((stimulus) => (
      stimulus.kind === 'operation' ? stimulus.operation_id : undefined
    ))).toEqual(['sdk_op_event_error', 'sdk_op_event_later']);
    expect(scenario.expected.errors).toEqual([
      {
        code: 'authorization',
        stimulus_index: 10,
        correlation: { kind: 'event', local_id: 'sdk_op_event_error' },
      },
    ]);

    const changed = structuredClone(corpus);
    delete changed.scenarios.find(
      ({ id }) => id === 'sdk_event_error_correlation',
    )!.expected.errors[0]!.correlation;
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'missing_trace' }),
    );
  });

  test('keeps the previous declaration active after locked activation fails', () => {
    const scenario = corpus.scenarios.find(
      ({ id }) => id === 'sdk_declaration_failure_rollback',
    )!;
    expect(scenario.expected.statuses.at(-1)).toBe('ready');
    expect(scenario.expected.declaration_visibility).toEqual([
      'previous',
      'previous',
      'desired',
      'previous',
      'desired',
    ]);
    expect(scenario.expected.declarations.filter(({ transaction }) => transaction === 2))
      .toHaveLength(4);
    expect(scenario.expected.declaration_promises).toEqual([
      {
        promise_id: 'sdk_decl_failed_state',
        transaction: 2,
        stimulus_index: 16,
        outcome: 'rejected',
        code: 'ownership_collision',
      },
      {
        promise_id: 'sdk_decl_failed_access',
        transaction: 2,
        stimulus_index: 16,
        outcome: 'rejected',
        code: 'ownership_collision',
      },
      {
        promise_id: 'sdk_decl_recovery_events',
        transaction: 3,
        stimulus_index: 25,
        outcome: 'activated',
      },
    ]);
  });

  test('queues post-handoff updates and activates each complete snapshot in order', () => {
    const scenario = corpus.scenarios.find(
      ({ id }) => id === 'sdk_live_declaration_replacement',
    )!;
    expect(scenario.expected.declaration_promises).toEqual([
      {
        promise_id: 'sdk_decl_live_handed_off',
        transaction: 2,
        stimulus_index: 19,
        outcome: 'activated',
      },
      {
        promise_id: 'sdk_decl_live_queued',
        transaction: 3,
        stimulus_index: 30,
        outcome: 'activated',
      },
    ]);
    expect(scenario.expected.declaration_visibility).toEqual([
      'previous',
      'previous',
      'previous',
      'previous',
      'previous',
      'previous',
      'previous',
      'previous',
      'previous',
      'desired',
    ]);
    expect(scenario.expected.status_checkpoints.filter(({ status }) => status === 'ready'))
      .toEqual([
        { stimulus_index: 7, status: 'ready' },
        { stimulus_index: 30, status: 'ready' },
      ]);
  });

  test('supersedes only pre-handoff declarations and shares repeated stop settlement', () => {
    const scenario = corpus.scenarios.find(({ id }) => id === 'sdk_lifecycle_ownership')!;
    expect(scenario.expected.declaration_promises).toEqual([
      {
        promise_id: 'sdk_decl_stop_superseded',
        transaction: 2,
        stimulus_index: 11,
        outcome: 'rejected',
        code: 'superseded',
      },
      {
        promise_id: 'sdk_decl_stop_pending',
        transaction: 3,
        stimulus_index: 13,
        outcome: 'rejected',
        code: 'cancelled',
      },
    ]);
    expect(scenario.expected.lifecycle_promises.slice(-2)).toEqual([
      {
        operation: 'stop',
        promise_id: 'sdk_stop_shared',
        invocation_stimulus_index: 13,
        settlement_stimulus_index: 13,
        outcome: 'resolved',
      },
      {
        operation: 'stop',
        promise_id: 'sdk_stop_shared',
        invocation_stimulus_index: 14,
        settlement_stimulus_index: 13,
        outcome: 'resolved',
      },
    ]);
  });

  test('settles start at first readiness and rejects duplicate start immediately', () => {
    const scenario = corpus.scenarios.find(({ id }) => id === 'sdk_lifecycle_ownership')!;
    expect(scenario.expected.lifecycle_promises.slice(0, 2)).toEqual([
      {
        operation: 'start',
        promise_id: 'sdk_start_primary',
        invocation_stimulus_index: 0,
        settlement_stimulus_index: 8,
        outcome: 'resolved',
        session_id: 801,
        generation: 1,
      },
      {
        operation: 'start',
        promise_id: 'sdk_start_duplicate',
        invocation_stimulus_index: 1,
        settlement_stimulus_index: 1,
        outcome: 'rejected',
        code: 'invalid_lifecycle',
      },
    ]);

    const earlyStart = structuredClone(corpus);
    earlyStart.scenarios.find(({ id }) => id === 'sdk_lifecycle_ownership')!
      .expected.lifecycle_promises[0]!.settlement_stimulus_index = 7;
    expect(() => validateCoordinatorContractCorpus(earlyStart)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('rejects a distinct promise self-attested for repeated stop', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_lifecycle_ownership')!;
    const repeatedStop = scenario.stimuli.at(-1);
    if (repeatedStop?.kind !== 'stop') throw new Error('missing repeated stop');
    repeatedStop.promise_id = 'sdk_stop_not_shared';
    scenario.expected.lifecycle_promises.at(-1)!.promise_id = 'sdk_stop_not_shared';
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('keeps operation dispatch closed while a post-handoff update is queued', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(
      ({ id }) => id === 'sdk_live_declaration_replacement',
    )!;
    const firstQueuedProbe = scenario.stimuli.findIndex((stimulus, index) => {
      const previous = scenario.stimuli[index - 1];
      return stimulus.kind === 'declaration_probe'
        && previous?.kind === 'declaration_ack'
        && previous.transaction === 2
        && previous.domain === 'functions';
    });
    if (firstQueuedProbe === -1) throw new Error('missing queued declaration probe');
    scenario.stimuli[firstQueuedProbe] = {
      kind: 'operation',
      operation_id: 'sdk_op_during_queued_declaration',
      operation: 'state_set',
      phase: 'sent',
    };
    scenario.expected.declaration_visibility.splice(4, 1);
    scenario.expected.operations.push({
      operation_id: 'sdk_op_during_queued_declaration',
      operation: 'state_set',
      attempts: 1,
      outcome: 'outcome_unknown',
    });
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_lifecycle' }),
    );
  });

  test('requires explicit final-frame handoff before declaration activation', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!;
    const handoffIndex = scenario.stimuli.findIndex(({ kind }) => kind === 'declaration_handoff');
    if (handoffIndex === -1) throw new Error('missing declaration handoff');
    scenario.stimuli[handoffIndex] = { kind: 'declaration_probe' };
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_order' }),
    );
  });

  test('rejects desired-cache contamination even when snapshot evidence repeats it', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(
      ({ id }) => id === 'sdk_declaration_failure_rollback',
    )!;
    const recovery = scenario.stimuli.find((stimulus) => (
      stimulus.kind === 'declaration_update' && stimulus.transaction === 3
    ));
    if (recovery?.kind !== 'declaration_update') throw new Error('missing recovery update');
    recovery.revisions.state = 1;
    scenario.expected.declaration_snapshots.find(({ transaction }) => transaction === 3)!
      .revisions.state = 1;
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('treats CALL_ERROR as terminal and forbids later progress or result', () => {
    for (const kind of ['call_progress', 'call_result'] as const) {
      const changed = structuredClone(corpus);
      const scenario = changed.scenarios.find(({ id }) => id === 'sdk_call_streaming')!;
      const terminalIndex = scenario.stimuli.findIndex((stimulus) => (
        stimulus.kind === 'operation_terminal'
        && stimulus.operation_id === 'sdk_op_call_failed'
      ));
      if (terminalIndex === -1) throw new Error('missing CALL_ERROR terminal');
      scenario.stimuli[terminalIndex] = kind === 'call_progress'
        ? { kind, operation_id: 'sdk_op_call_failed', value: 'late' }
        : { kind, operation_id: 'sdk_op_call_failed', value: 'late' };
      expect(() => validateCoordinatorContractCorpus(changed), kind).toThrow(
        expect.objectContaining({ code: 'invalid_reference' }),
      );
    }
  });

  test('requires real cancellation requests and their matching terminal outcome', () => {
    const noCancellation = structuredClone(corpus);
    const noCancellationScenario = noCancellation.scenarios.find(
      ({ id }) => id === 'sdk_call_cancellation',
    )!;
    noCancellationScenario.stimuli = noCancellationScenario.stimuli.filter(
      ({ kind }) => kind !== 'call_cancel',
    );
    expect(() => validateCoordinatorContractCorpus(noCancellation)).toThrow(
      expect.objectContaining({ code: 'missing_coverage' }),
    );

    const wrongTerminal = structuredClone(corpus);
    const wrongTerminalScenario = wrongTerminal.scenarios.find(
      ({ id }) => id === 'sdk_call_cancellation',
    )!;
    const terminal = wrongTerminalScenario.stimuli.find((stimulus) => (
      stimulus.kind === 'operation_terminal'
      && stimulus.operation_id === 'sdk_op_cancel_before_accept'
    ));
    if (terminal?.kind !== 'operation_terminal') throw new Error('missing cancellation terminal');
    terminal.outcome = 'outcome_unknown';
    expect(() => validateCoordinatorContractCorpus(wrongTerminal)).toThrow(
      expect.objectContaining({ code: 'invalid_outcome' }),
    );
  });

  test('does not restore ready when reconnect synchronization fails', () => {
    const failedReconnect = structuredClone(corpus);
    const scenario = failedReconnect.scenarios.find(
      ({ id }) => id === 'sdk_reconnect_reconciliation',
    )!;
    const welcomeIndexes = scenario.stimuli.flatMap((stimulus, index) => (
      stimulus.kind === 'welcome' ? [index] : []
    ));
    const reconnectWelcomeIndex = welcomeIndexes[1];
    if (reconnectWelcomeIndex === undefined) throw new Error('missing reconnect welcome');
    const errorIndex = reconnectWelcomeIndex + 1;
    scenario.stimuli.splice(errorIndex, scenario.stimuli.length - errorIndex, {
      kind: 'declaration_error',
      domain: 'state',
      transaction: 1,
      code: 'internal',
    });
    scenario.expected.statuses.pop();
    scenario.expected.status_checkpoints.pop();
    scenario.expected.declarations.splice(6);
    scenario.expected.declaration_promises = [{
      promise_id: 'sdk_decl_reconnect_pending',
      transaction: 2,
      stimulus_index: errorIndex,
      outcome: 'rejected',
      code: 'internal',
    }];
    scenario.expected.declaration_visibility = ['previous'];
    scenario.expected.errors = [{ code: 'internal', stimulus_index: errorIndex }];
    expect(() => validateCoordinatorContractCorpus(failedReconnect)).not.toThrow();

    const dispatched = structuredClone(failedReconnect);
    const dispatchedScenario = dispatched.scenarios.find(
      ({ id }) => id === 'sdk_reconnect_reconciliation',
    )!;
    dispatchedScenario.stimuli.push(
      {
        kind: 'operation',
        operation_id: 'sdk_op_after_failed_reconnect',
        operation: 'state_set',
        phase: 'sent',
      },
      {
        kind: 'operation_terminal',
        operation_id: 'sdk_op_after_failed_reconnect',
        outcome: 'outcome_unknown',
      },
    );
    dispatchedScenario.expected.operations.push({
      operation_id: 'sdk_op_after_failed_reconnect',
      operation: 'state_set',
      attempts: 1,
      outcome: 'outcome_unknown',
    });
    expect(() => validateCoordinatorContractCorpus(dispatched)).toThrow(
      expect.objectContaining({ code: 'invalid_lifecycle' }),
    );
  });

  test('rejects cross-domain causal mutations with stable violation codes', () => {
    const cases: Array<{
      name: string;
      code: string;
      mutate(value: typeof corpus): void;
    }> = [
      {
        name: 'startup without ready',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!
            .expected.statuses.pop();
        },
      },
      {
        name: 'unfinished live replacement',
        code: 'missing_trace',
        mutate(value) {
          const scenario = value.scenarios.find(
            ({ id }) => id === 'sdk_live_declaration_replacement',
          )!;
          scenario.stimuli.splice(-2, 2);
          scenario.expected.statuses.pop();
          scenario.expected.status_checkpoints.pop();
          scenario.expected.declarations.pop();
          scenario.expected.declaration_promises.pop();
          scenario.expected.declaration_visibility.pop();
        },
      },
      {
        name: 'ready checkpoint before final declaration acknowledgement',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!
            .expected.status_checkpoints.at(-1)!.stimulus_index = 8;
        },
      },
      {
        name: 'unsorted presence even when self-attested consistently',
        code: 'invalid_order',
        mutate(value) {
          const scenario = value.scenarios.find(({ id }) => id === 'sdk_presence_cleanup')!;
          const stimulus = scenario.stimuli.find(({ kind }) => kind === 'presence');
          if (stimulus?.kind !== 'presence') throw new Error('missing presence stimulus');
          [stimulus.entries[0], stimulus.entries[1]] = [stimulus.entries[1]!, stimulus.entries[0]!];
          [scenario.expected.presence[0]![0], scenario.expected.presence[0]![1]] = [
            scenario.expected.presence[0]![1]!,
            scenario.expected.presence[0]![0]!,
          ];
        },
      },
      {
        name: 'transient second socket',
        code: 'resource_limit',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!
            .expected.resources.socket_high_water = 2;
        },
      },
      {
        name: 'dropped disconnect call terminal',
        code: 'missing_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_reconnect_reconciliation')!
            .expected.call_streams.shift();
        },
      },
      {
        name: 'offline operation falsely dispatched',
        code: 'invalid_lifecycle',
        mutate(value) {
          const scenario = value.scenarios.find(({ id }) => id === 'sdk_offline_rejection')!;
          const operation = scenario.stimuli.find((stimulus) => (
            stimulus.kind === 'operation' && stimulus.operation === 'state_set'
          ));
          if (operation?.kind !== 'operation') throw new Error('missing offline state operation');
          operation.phase = 'sent';
          scenario.expected.operations[0]!.attempts = 1;
          scenario.expected.operations[0]!.outcome = 'outcome_unknown';
        },
      },
      {
        name: 'accepted non-call operation',
        code: 'invalid_outcome',
        mutate(value) {
          const operation = value.scenarios.find(({ id }) => id === 'sdk_offline_rejection')!
            .stimuli.find((stimulus) => (
              stimulus.kind === 'operation' && stimulus.operation === 'state_set'
            ));
          if (operation?.kind !== 'operation') throw new Error('missing state operation');
          operation.phase = 'accepted';
        },
      },
      {
        name: 'false call acceptance result',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_call_streaming')!
            .expected.call_streams[0]!.acceptance = 'rejected';
        },
      },
      {
        name: 'failed declaration remains cached after rollback',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_declaration_failure_rollback')!
            .expected.declaration_visibility[2] = 'previous';
        },
      },
      {
        name: 'dropped declaration error checkpoint',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_declaration_failure_rollback')!
            .expected.errors = [];
        },
      },
      {
        name: 'dropped declaration promise settlement',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_declaration_failure_rollback')!
            .expected.declaration_promises.pop();
        },
      },
      {
        name: 'failed declaration promise falsely activated',
        code: 'invalid_trace',
        mutate(value) {
          const settlement = value.scenarios.find(
            ({ id }) => id === 'sdk_declaration_failure_rollback',
          )!.expected.declaration_promises[0]!;
          settlement.outcome = 'activated';
          delete settlement.code;
        },
      },
      {
        name: 'event relay error without transport handoff',
        code: 'invalid_order',
        mutate(value) {
          const scenario = value.scenarios.find(
            ({ id }) => id === 'sdk_event_error_correlation',
          )!;
          const operation = scenario.stimuli.find((stimulus) => (
            stimulus.kind === 'operation' && stimulus.operation_id === 'sdk_op_event_error'
          ));
          if (operation?.kind !== 'operation') throw new Error('missing event operation');
          operation.phase = 'before_send';
          scenario.expected.operations[0]!.attempts = 0;
          scenario.expected.operations[0]!.outcome = 'not_dispatched';
        },
      },
      {
        name: 'call relay terminal before correlated error',
        code: 'missing_trace',
        mutate(value) {
          const scenario = value.scenarios.find(({ id }) => id === 'sdk_call_cancellation')!;
          const errorIndex = scenario.stimuli.findIndex((stimulus) => (
            stimulus.kind === 'operation_error'
            && stimulus.operation_id === 'sdk_op_rejected_before_accept'
          ));
          if (errorIndex === -1) throw new Error('missing call relay error');
          [scenario.stimuli[errorIndex], scenario.stimuli[errorIndex + 1]] = [
            scenario.stimuli[errorIndex + 1]!,
            scenario.stimuli[errorIndex]!,
          ];
          scenario.expected.errors[0]!.stimulus_index = errorIndex + 1;
        },
      },
      {
        name: 'pre-accept cancellation without relay terminal',
        code: 'missing_trace',
        mutate(value) {
          const scenario = value.scenarios.find(({ id }) => id === 'sdk_call_cancellation')!;
          const terminalIndex = scenario.stimuli.findIndex((stimulus) => (
            stimulus.kind === 'operation_terminal'
            && stimulus.operation_id === 'sdk_op_cancel_before_accept'
          ));
          if (terminalIndex === -1) throw new Error('missing cancellation terminal');
          scenario.stimuli.splice(terminalIndex, 1);
        },
      },
      {
        name: 'event relay error after connection close',
        code: 'invalid_order',
        mutate(value) {
          const scenario = value.scenarios.find(
            ({ id }) => id === 'sdk_event_error_correlation',
          )!;
          const errorIndex = scenario.stimuli.findIndex(({ kind }) => kind === 'operation_error');
          if (errorIndex === -1) throw new Error('missing event relay error');
          scenario.stimuli.splice(errorIndex, 0, { kind: 'disconnect', phase: 'ready' });
          scenario.expected.statuses.push('reconnecting');
          scenario.expected.status_checkpoints.push({
            stimulus_index: errorIndex,
            status: 'reconnecting',
          });
          scenario.expected.errors[0]!.stimulus_index = errorIndex + 1;
        },
      },
      {
        name: 'invented uncorrelated error',
        code: 'invalid_trace',
        mutate(value) {
          value.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!
            .expected.errors.push({ code: 'internal', stimulus_index: 0 });
        },
      },
      {
        name: 'socket created during inert construction',
        code: 'resource_leak',
        mutate(value) {
          const resources = value.scenarios.find(({ id }) => id === 'sdk_inert_construction')!
            .expected.resources;
          resources.sockets = 1;
          resources.socket_high_water = 1;
        },
      },
    ];

    for (const entry of cases) {
      const changed = structuredClone(corpus);
      entry.mutate(changed);
      expect(() => validateCoordinatorContractCorpus(changed), entry.name).toThrow(
        expect.objectContaining({ code: entry.code }),
      );
    }
  });

  test('rejects impossible lifecycle transitions', () => {
    const changed = structuredClone(corpus);
    const scenario = changed.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!;
    scenario.expected.statuses.push('connecting');
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'invalid_trace' }),
    );
  });

  test('bounds every coordinator to one managed socket', () => {
    const changed = structuredClone(corpus);
    changed.scenarios.find(({ id }) => id === 'sdk_startup_barrier')!.expected.resources.sockets = 2;
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'resource_limit' }),
    );
  });

  test('bounds aggregate in-memory corpus values', () => {
    const changed = structuredClone(corpus);
    changed.scenarios[0]!.description = 'x'.repeat(CONTRACT_LIMITS.corpusStringBytes + 1);
    expect(() => validateCoordinatorContractCorpus(changed)).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }),
    );
  });

  test('rejects repeated references across subject progress values', () => {
    const observation = structuredClone(corpus.scenarios.find(
      ({ id }) => id === 'sdk_call_streaming',
    )!.expected);
    const sharedProgress = { stage: 'shared' };
    observation.call_streams[0]!.progress = [sharedProgress, sharedProgress];

    expect(() => validateContractObservation(observation)).toThrow(
      expect.objectContaining({ code: 'invalid_value' }),
    );
  });

  test('bounds aggregate subject observation values and strings', () => {
    const expected = corpus.scenarios.find(({ id }) => id === 'sdk_inert_construction')!.expected;
    const tooManyValues = structuredClone(expected);
    tooManyValues.call_streams = Array.from(
      { length: CONTRACT_LIMITS.traceEntries },
      (_, index) => ({
        operation_id: `sdk_op_budget_${index}`,
        acceptance: 'resolved' as const,
        progress: Array.from({ length: CONTRACT_LIMITS.traceEntries }, () => null),
        terminal: { kind: 'result' as const, value: null },
      }),
    );
    expect(() => validateContractObservation(tooManyValues)).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }),
    );

    const tooManyStringBytes = structuredClone(expected);
    const maximumJsonString = 'x'.repeat(1_024);
    tooManyStringBytes.call_streams = Array.from({ length: 5 }, (_, index) => ({
      operation_id: `sdk_op_string_budget_${index}`,
      acceptance: 'resolved' as const,
      progress: Array.from(
        { length: CONTRACT_LIMITS.traceEntries },
        () => maximumJsonString,
      ),
      terminal: { kind: 'result' as const, value: null },
    }));
    expect(() => validateContractObservation(tooManyStringBytes)).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }),
    );
  });

  test('rejects an oversized corpus file before parsing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'miakapp-contract-'));
    const fixture = join(directory, 'oversized.json');
    try {
      await writeFile(fixture, Buffer.alloc(CONTRACT_LIMITS.corpusBytes + 1, 0x20));
      await expect(loadCoordinatorContractCorpus(pathToFileURL(fixture))).rejects.toMatchObject({
        code: 'limit_exceeded',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
