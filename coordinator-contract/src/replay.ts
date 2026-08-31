import {
  type ContractObservation,
  type ContractProfile,
  type ContractSetup,
  type ContractStimulus,
  type CoordinatorContractCorpus,
  type CoordinatorContractScenario,
  selectCoordinatorContractScenarios,
  validateContractObservation,
} from './contract.js';

export const DEFAULT_CONTRACT_HOOK_TIMEOUT_MS = 5_000;
const MAX_CONTRACT_HOOK_TIMEOUT_MS = 60_000;

export interface ContractReplaySetup extends ContractSetup {
  scenario_id: string;
}

export interface CoordinatorContractSubject {
  reset(setup: ContractReplaySetup, signal: AbortSignal): Promise<void> | void;
  dispatch(stimulus: ContractStimulus, signal: AbortSignal): Promise<void> | void;
  observe(signal: AbortSignal): Promise<unknown> | unknown;
}

export interface ContractReplayOptions {
  hookTimeoutMs?: number;
  profile?: ContractProfile;
  signal?: AbortSignal;
}

export interface ContractReplayResult {
  scenario_id: string;
  stimuli_dispatched: number;
  observation: ContractObservation;
}

interface Difference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export class ContractDivergence extends Error {
  readonly scenarioId: string;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(scenarioId: string, difference: Difference) {
    super(`Coordinator contract scenario ${scenarioId} diverged at ${difference.path}`);
    this.name = 'ContractDivergence';
    this.scenarioId = scenarioId;
    this.path = difference.path;
    this.expected = difference.expected;
    this.actual = difference.actual;
  }
}

export class ContractTimeout extends Error {
  readonly scenarioId: string;
  readonly stage: string;
  readonly timeoutMs: number;

  constructor(scenarioId: string, stage: string, timeoutMs: number) {
    super(`Coordinator contract scenario ${scenarioId} timed out during ${stage} after ${timeoutMs} ms`);
    this.name = 'ContractTimeout';
    this.scenarioId = scenarioId;
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export class ContractCancelled extends Error {
  readonly scenarioId: string;
  readonly stage: string;

  constructor(scenarioId: string, stage: string) {
    super(`Coordinator contract scenario ${scenarioId} was cancelled during ${stage}`);
    this.name = 'ContractCancelled';
    this.scenarioId = scenarioId;
    this.stage = stage;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function timeoutFrom(options: ContractReplayOptions): number {
  const timeoutMs = options.hookTimeoutMs ?? DEFAULT_CONTRACT_HOOK_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_CONTRACT_HOOK_TIMEOUT_MS) {
    throw new RangeError(
      `hookTimeoutMs must be an integer between 1 and ${MAX_CONTRACT_HOOK_TIMEOUT_MS}`,
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
  if (parentSignal?.aborted === true) throw new ContractCancelled(scenarioId, stage);
  const controller = new AbortController();
  const cancel = () => controller.abort(new ContractCancelled(scenarioId, stage));
  parentSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new ContractTimeout(scenarioId, stage, timeoutMs));
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findDifference(expected: unknown, actual: unknown, path = '$'): Difference | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return { path, expected, actual };
    if (expected.length !== actual.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
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

function scenarioById(
  corpus: CoordinatorContractCorpus,
  scenarioId: string,
): CoordinatorContractScenario {
  const scenario = corpus.scenarios.find(({ id }) => id === scenarioId);
  if (scenario === undefined) throw new Error(`Unknown coordinator contract scenario: ${scenarioId}`);
  return scenario;
}

export async function replayContractScenario(
  corpus: CoordinatorContractCorpus,
  scenarioId: string,
  subject: CoordinatorContractSubject,
  options: ContractReplayOptions = {},
): Promise<ContractReplayResult> {
  const scenario = scenarioById(corpus, scenarioId);
  const timeoutMs = timeoutFrom(options);
  const setup: ContractReplaySetup = { scenario_id: scenario.id, ...clone(scenario.setup) };
  await runHook(scenario.id, 'reset', timeoutMs, options.signal, (signal) => (
    subject.reset(setup, signal)
  ));
  for (let index = 0; index < scenario.stimuli.length; index += 1) {
    await runHook(
      scenario.id,
      `dispatch[${index}]`,
      timeoutMs,
      options.signal,
      (signal) => subject.dispatch(clone(scenario.stimuli[index]!), signal),
    );
  }
  const observation = await runHook(
    scenario.id,
    'observe',
    timeoutMs,
    options.signal,
    async (signal) => {
      const observed = await subject.observe(signal);
      if (signal.aborted) throw signal.reason;
      const validated = validateContractObservation(
        observed,
        `subject observation for ${scenario.id}`,
      );
      if (signal.aborted) throw signal.reason;
      const difference = findDifference(scenario.expected, validated);
      if (difference !== undefined) throw new ContractDivergence(scenario.id, difference);
      if (signal.aborted) throw signal.reason;
      return validated;
    },
  );
  return {
    scenario_id: scenario.id,
    stimuli_dispatched: scenario.stimuli.length,
    observation: clone(observation),
  };
}

export async function replayContractCorpus(
  corpus: CoordinatorContractCorpus,
  subject: CoordinatorContractSubject,
  options: ContractReplayOptions = {},
): Promise<ContractReplayResult[]> {
  const results: ContractReplayResult[] = [];
  const scenarios = selectCoordinatorContractScenarios(corpus, options.profile ?? 'all');
  for (const scenario of scenarios) {
    results.push(await replayContractScenario(corpus, scenario.id, subject, options));
  }
  return results;
}
