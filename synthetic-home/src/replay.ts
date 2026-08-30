import {
  type FixtureContext,
  type JsonValue,
  type ReplayObservation,
  type ScenarioStimulus,
  type SyntheticHome,
  type SyntheticScenario,
  isPlainRecord,
  validateReplayObservation,
} from './contract.js';
import type { SyntheticHomeCorpus } from './corpus.js';

export const DEFAULT_REPLAY_HOOK_TIMEOUT_MS = 5_000;
const MAX_REPLAY_HOOK_TIMEOUT_MS = 60_000;

export interface ReplaySetup {
  scenario_id: string;
  seed: number;
  clock: string;
  connection: 'connected' | 'disconnected';
  home: SyntheticHome;
  state: Record<string, JsonValue>;
  context: FixtureContext;
}

export interface ReplaySubject {
  reset(setup: ReplaySetup, signal: AbortSignal): Promise<void> | void;
  dispatch(stimulus: ScenarioStimulus, signal: AbortSignal): Promise<void> | void;
  observe(signal: AbortSignal): Promise<unknown> | unknown;
}

export interface ReplayOptions {
  hookTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ReplayResult {
  scenario_id: string;
  stimuli_dispatched: number;
  observation: ReplayObservation;
}

interface Difference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export class ReplayDivergence extends Error {
  readonly scenarioId: string;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(scenarioId: string, difference: Difference) {
    super(`Scenario ${scenarioId} diverged at ${difference.path}`);
    this.name = 'ReplayDivergence';
    this.scenarioId = scenarioId;
    this.path = difference.path;
    this.expected = difference.expected;
    this.actual = difference.actual;
  }
}

export class ReplayTimeout extends Error {
  readonly scenarioId: string;
  readonly stage: string;
  readonly timeoutMs: number;

  constructor(scenarioId: string, stage: string, timeoutMs: number) {
    super(`Scenario ${scenarioId} timed out during ${stage} after ${timeoutMs} ms`);
    this.name = 'ReplayTimeout';
    this.scenarioId = scenarioId;
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export class ReplayCancelled extends Error {
  readonly scenarioId: string;
  readonly stage: string;

  constructor(scenarioId: string, stage: string) {
    super(`Scenario ${scenarioId} was cancelled during ${stage}`);
    this.name = 'ReplayCancelled';
    this.scenarioId = scenarioId;
    this.stage = stage;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mergeContext(base: FixtureContext, overlay: FixtureContext): FixtureContext {
  const flows: Record<string, Record<string, JsonValue>> = {};
  const flowIds = new Set([...Object.keys(base.flows), ...Object.keys(overlay.flows)]);
  for (const flowId of flowIds) {
    flows[flowId] = {
      ...(base.flows[flowId] ?? {}),
      ...(overlay.flows[flowId] ?? {}),
    };
  }
  return {
    global: { ...base.global, ...overlay.global },
    flows,
  };
}

function replayTimeout(options: ReplayOptions): number {
  const timeoutMs = options.hookTimeoutMs ?? DEFAULT_REPLAY_HOOK_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_REPLAY_HOOK_TIMEOUT_MS) {
    throw new RangeError(
      `hookTimeoutMs must be an integer between 1 and ${MAX_REPLAY_HOOK_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

async function runHook<T>(
  scenarioId: string,
  stage: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  invoke: (signal: AbortSignal) => Promise<T> | T,
): Promise<T> {
  if (parentSignal?.aborted === true) throw new ReplayCancelled(scenarioId, stage);
  const controller = new AbortController();
  const cancel = () => controller.abort(new ReplayCancelled(scenarioId, stage));
  parentSignal?.addEventListener('abort', cancel, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new ReplayTimeout(scenarioId, stage, timeoutMs));
  }, timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectWithReason = () => reject(controller.signal.reason);
    if (controller.signal.aborted) rejectWithReason();
    else controller.signal.addEventListener('abort', rejectWithReason, { once: true });
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => invoke(controller.signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', cancel);
  }
}

function findDifference(expected: unknown, actual: unknown, path = '$'): Difference | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return { path, expected, actual };
    if (expected.length !== actual.length) return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = findDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  if (isPlainRecord(expected) || isPlainRecord(actual)) {
    if (!isPlainRecord(expected) || !isPlainRecord(actual)) return { path, expected, actual };
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    const keyDifference = findDifference(expectedKeys, actualKeys, `${path}#keys`);
    if (keyDifference !== undefined) return keyDifference;
    for (const key of expectedKeys) {
      const difference = findDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  return { path, expected, actual };
}

function scenarioById(corpus: SyntheticHomeCorpus, scenarioId: string): SyntheticScenario {
  const scenario = corpus.scenarios.scenarios.find(({ id }) => id === scenarioId);
  if (scenario === undefined) throw new Error(`Unknown synthetic-home scenario: ${scenarioId}`);
  return scenario;
}

function replaySetup(corpus: SyntheticHomeCorpus, scenario: SyntheticScenario): ReplaySetup {
  return {
    scenario_id: scenario.id,
    seed: corpus.manifest.seed,
    clock: corpus.manifest.clock.start,
    connection: scenario.setup.connection,
    home: clone(corpus.home),
    state: clone({ ...corpus.home.initial_state, ...scenario.setup.state }),
    context: clone(mergeContext(corpus.home.initial_context, scenario.setup.context)),
  };
}

function expectedReplayObservation(
  setup: ReplaySetup,
  scenario: SyntheticScenario,
): ReplayObservation {
  return {
    state: { ...setup.state, ...scenario.expected.state_patch },
    context: mergeContext(setup.context, scenario.expected.context_patch),
    recorded_commands: clone(scenario.expected.recorded_commands),
    notification_intents: clone(scenario.expected.notification_intents),
    lifecycle: clone(scenario.expected.lifecycle),
    operations: clone(scenario.expected.operations),
  };
}

export async function replayScenario(
  corpus: SyntheticHomeCorpus,
  scenarioId: string,
  subject: ReplaySubject,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const scenario = scenarioById(corpus, scenarioId);
  const setup = replaySetup(corpus, scenario);
  const timeoutMs = replayTimeout(options);
  await runHook(scenario.id, 'reset', timeoutMs, options.signal, (signal) => (
    subject.reset(clone(setup), signal)
  ));
  for (let index = 0; index < scenario.stimuli.length; index += 1) {
    const stimulus = scenario.stimuli[index]!;
    await runHook(
      scenario.id,
      `dispatch[${index}]`,
      timeoutMs,
      options.signal,
      (signal) => subject.dispatch(clone(stimulus), signal),
    );
  }

  const observation = validateReplayObservation(
    await runHook(
      scenario.id,
      'observe',
      timeoutMs,
      options.signal,
      (signal) => subject.observe(signal),
    ),
    `subject observation for ${scenario.id}`,
  );
  const difference = findDifference(expectedReplayObservation(setup, scenario), observation);
  if (difference !== undefined) throw new ReplayDivergence(scenario.id, difference);
  return {
    scenario_id: scenario.id,
    stimuli_dispatched: scenario.stimuli.length,
    observation: clone(observation),
  };
}

export async function replayCorpus(
  corpus: SyntheticHomeCorpus,
  subject: ReplaySubject,
  options: ReplayOptions = {},
): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  for (const scenario of corpus.scenarios.scenarios) {
    results.push(await replayScenario(corpus, scenario.id, subject, options));
  }
  return results;
}
