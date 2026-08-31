import {
  type JsonValue,
  type NotificationIntent,
  type RecordedCommand,
  type ReplayObservation,
  type ReplaySetup,
  type ReplaySubject,
  type ScenarioStimulus,
  validateJsonValue,
  validateReplayObservation,
  validateStatePath,
} from '@miakapp/synthetic-home-conformance';

export type MigrationHarnessMode = 'observe' | 'shadow_state' | 'recorded_action';

export type RecordedEffect =
  | { kind: 'device_command'; command: RecordedCommand }
  | { kind: 'notification_intent'; intent: NotificationIntent };

export class UnclassifiedEffect extends Error {
  readonly code = 'unclassified_effect';

  constructor() {
    super('Migration adapter attempted an unclassified effect');
    this.name = 'UnclassifiedEffect';
  }
}

export class MissingStatePublication extends Error {
  readonly code = 'missing_state_publication';

  constructor() {
    super('Migration adapter did not publish state before the causal checkpoint');
    this.name = 'MissingStatePublication';
  }
}

export class StatePublicationDisabled extends Error {
  constructor() {
    super('State publication is disabled in observe mode');
    this.name = 'StatePublicationDisabled';
  }
}

export class CapabilityLeaseExpired extends Error {
  readonly code = 'capability_lease_expired';

  constructor() {
    super('Migration capability lease is no longer active');
    this.name = 'CapabilityLeaseExpired';
  }
}

export interface EffectSink {
  record(effect: unknown): void;
}

export interface StatePublisher {
  publish(state: Readonly<Record<string, JsonValue>>, signal: AbortSignal): Promise<void>;
}

export interface MigrationCapabilities {
  readonly mode: MigrationHarnessMode;
  readonly effects: EffectSink;
  readonly state: StatePublisher;
}

export interface MigrationAdapterSubject {
  reset(
    setup: ReplaySetup,
    capabilities: MigrationCapabilities,
    signal: AbortSignal,
  ): Promise<void> | void;

  dispatch(
    stimulus: ScenarioStimulus,
    capabilities: MigrationCapabilities,
    signal: AbortSignal,
  ): Promise<void> | void;

  observe(signal: AbortSignal): Promise<unknown> | unknown;
}

const MAX_RECORDED_EFFECTS = 64;
const MAX_STATE_PUBLICATIONS = 256;
const MAX_EFFECT_BYTES = 1_048_576;
const MAX_STATE_PUBLICATION_BYTES = 4_194_304;
const VALUE_BYTES = new TextEncoder();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function estimatedValueBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current === 'boolean') {
      bytes += 1;
    } else if (typeof current === 'number') {
      bytes += 8;
    } else if (typeof current === 'string') {
      bytes += VALUE_BYTES.encode(current).byteLength;
    } else if (current instanceof Uint8Array) {
      bytes += current.byteLength;
    } else if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) throw new TypeError('Migration evidence contains a cycle');
      seen.add(current);
      if (Array.isArray(current)) {
        stack.push(...current);
      } else {
        for (const [key, child] of Object.entries(current)) {
          bytes += VALUE_BYTES.encode(key).byteLength;
          stack.push(child);
        }
      }
    }
  }
  return bytes;
}

function validateRecordedEffect(value: unknown): RecordedEffect {
  const record = asRecord(value);
  if (record === undefined || Object.keys(record).some((key) => !['kind', 'command', 'intent'].includes(key))) {
    throw new UnclassifiedEffect();
  }
  if (record.kind === 'device_command' && Object.hasOwn(record, 'command') && !Object.hasOwn(record, 'intent')) {
    const observation = validateReplayObservation({
      state: {},
      context: { global: {}, flows: {} },
      recorded_commands: [record.command],
      notification_intents: [],
      lifecycle: [],
      operations: [],
    }, 'recorded device effect');
    return { kind: 'device_command', command: observation.recorded_commands[0]! };
  }
  if (record.kind === 'notification_intent' && Object.hasOwn(record, 'intent') && !Object.hasOwn(record, 'command')) {
    const observation = validateReplayObservation({
      state: {},
      context: { global: {}, flows: {} },
      recorded_commands: [],
      notification_intents: [record.intent],
      lifecycle: [],
      operations: [],
    }, 'recorded notification effect');
    return { kind: 'notification_intent', intent: observation.notification_intents[0]! };
  }
  throw new UnclassifiedEffect();
}

export class RecordingEffectSink implements EffectSink {
  #commands: RecordedCommand[] = [];
  #notifications: NotificationIntent[] = [];
  #recordedBytes = 0;

  record(value: unknown): void {
    if (this.#commands.length + this.#notifications.length >= MAX_RECORDED_EFFECTS) {
      throw new RangeError('Migration effect recorder limit exceeded');
    }
    const effect = validateRecordedEffect(value);
    const bytes = estimatedValueBytes(effect);
    if (this.#recordedBytes + bytes > MAX_EFFECT_BYTES) {
      throw new RangeError('Migration effect recorder byte budget exceeded');
    }
    this.#recordedBytes += bytes;
    if (effect.kind === 'device_command') this.#commands.push(clone(effect.command));
    else this.#notifications.push(clone(effect.intent));
  }

  reset(): void {
    this.#commands = [];
    this.#notifications = [];
    this.#recordedBytes = 0;
  }

  snapshot(): Pick<ReplayObservation, 'recorded_commands' | 'notification_intents'> {
    return {
      recorded_commands: clone(this.#commands),
      notification_intents: clone(this.#notifications),
    };
  }
}

export class RecordingStatePublisher implements StatePublisher {
  #enabled: boolean;
  #latest: Record<string, JsonValue> | undefined;
  #publicationCount = 0;
  #publishedBytes = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  async publish(state: Readonly<Record<string, JsonValue>>, signal: AbortSignal): Promise<void> {
    if (!this.#enabled) throw new StatePublicationDisabled();
    if (signal.aborted) throw signal.reason;
    if (this.#publicationCount >= MAX_STATE_PUBLICATIONS) {
      throw new RangeError('Migration state publication limit exceeded');
    }
    if (asRecord(state) === undefined) {
      throw new TypeError('Migration state publication must be a plain record');
    }
    validateJsonValue(state, 'migration state publication');
    for (const path of Object.keys(state)) validateStatePath(path, 'migration state path');
    const bytes = estimatedValueBytes(state);
    if (this.#publishedBytes + bytes > MAX_STATE_PUBLICATION_BYTES) {
      throw new RangeError('Migration state publication byte budget exceeded');
    }
    this.#publishedBytes += bytes;
    this.#publicationCount += 1;
    this.#latest = clone(state);
  }

  reset(enabled = this.#enabled): void {
    this.#enabled = enabled;
    this.#latest = undefined;
    this.#publicationCount = 0;
    this.#publishedBytes = 0;
  }

  evidence(): { publicationCount: number; latest?: Record<string, JsonValue> } {
    return this.#latest === undefined
      ? { publicationCount: this.#publicationCount }
      : { publicationCount: this.#publicationCount, latest: clone(this.#latest) };
  }
}

export interface MigrationReplayHarness {
  readonly subject: ReplaySubject;
  readonly effects: RecordingEffectSink;
  readonly state: RecordingStatePublisher;
}

export function createMigrationReplayHarness(
  adapter: MigrationAdapterSubject,
  mode: MigrationHarnessMode,
): MigrationReplayHarness {
  const effects = new RecordingEffectSink();
  const state = new RecordingStatePublisher(mode !== 'observe');
  let activeLease: {
    active: boolean;
    capabilities: MigrationCapabilities;
  } | undefined;

  const revoke = (lease = activeLease): void => {
    if (lease !== undefined) lease.active = false;
  };
  const createLease = (): NonNullable<typeof activeLease> => {
    const lease = { active: true } as NonNullable<typeof activeLease>;
    const assertActive = (): void => {
      if (!lease.active) throw new CapabilityLeaseExpired();
    };
    lease.capabilities = Object.freeze({
      mode,
      effects: Object.freeze({
        record: (effect: unknown) => {
          assertActive();
          effects.record(effect);
        },
      }),
      state: Object.freeze({
        publish: (snapshot: Readonly<Record<string, JsonValue>>, signal: AbortSignal) => {
          assertActive();
          return state.publish(snapshot, signal);
        },
      }),
    });
    return lease;
  };
  const runWithLease = async <T>(
    lease: NonNullable<typeof activeLease>,
    signal: AbortSignal,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    if (!lease.active) throw new CapabilityLeaseExpired();
    const abort = () => revoke(lease);
    if (signal.aborted) {
      abort();
      throw signal.reason;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await action();
    } catch (error) {
      revoke(lease);
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };

  const subject: ReplaySubject = {
    async reset(setup, signal) {
      revoke();
      effects.reset();
      state.reset(mode !== 'observe');
      const lease = createLease();
      activeLease = lease;
      await runWithLease(lease, signal, () => (
        adapter.reset(clone(setup), lease.capabilities, signal)
      ));
    },
    async dispatch(stimulus, signal) {
      const lease = activeLease;
      if (lease === undefined) throw new CapabilityLeaseExpired();
      await runWithLease(lease, signal, () => (
        adapter.dispatch(clone(stimulus), lease.capabilities, signal)
      ));
    },
    async observe(signal) {
      const lease = activeLease;
      if (lease === undefined || !lease.active) throw new CapabilityLeaseExpired();
      revoke(lease);
      activeLease = undefined;
      const claimed = validateReplayObservation(
        await adapter.observe(signal),
        'migration adapter observation',
      );
      const recorded = effects.snapshot();
      const stateEvidence = state.evidence();
      if (mode !== 'observe' && stateEvidence.latest === undefined) {
        throw new MissingStatePublication();
      }
      return {
        ...claimed,
        state: stateEvidence.latest ?? claimed.state,
        recorded_commands: recorded.recorded_commands,
        notification_intents: recorded.notification_intents,
      };
    },
  };

  return { subject, effects, state };
}
