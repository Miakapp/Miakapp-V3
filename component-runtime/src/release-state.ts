import {
  ContractViolation,
  isPlainRecord,
  validatePointer,
  type ComponentPointerV1,
  type PointerValidationContext,
} from './contract';

export const RELEASE_STATE_SCHEMA = 'miakapp.component-release-state/1' as const;

const DEFAULT_DATABASE_NAME = 'miakapp-component-release-metadata-v1';
const DATABASE_VERSION = 1;
const RELEASE_STORE = 'releases';

export interface ComponentReleaseState {
  readonly schema: typeof RELEASE_STATE_SCHEMA;
  readonly home_id: string;
  readonly highest_accepted: ComponentPointerV1;
  readonly last_known_good?: ComponentPointerV1;
}

export type CandidateEffectPhase = 'staging' | 'effects_may_have_started';

export interface AutomaticFallbackOptions {
  readonly phase: CandidateEffectPhase;
  readonly quarantinedDigests?: ReadonlySet<string>;
}

export interface ReleaseMetadataMutation<T> {
  readonly record: ComponentReleaseState;
  readonly value: T;
}

export interface ReleaseMetadataStore {
  read(homeId: string): Promise<unknown | undefined>;
  transact<T>(
    homeId: string,
    mutation: (current: unknown | undefined) => ReleaseMetadataMutation<T>,
  ): Promise<T>;
}

function fail(code: string, message: string): never {
  throw new ContractViolation(code, message);
}

function ownExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('release_metadata_invalid', 'release metadata must be a plain record');
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('release_metadata_invalid', 'release metadata is missing ' + key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('release_metadata_invalid', 'release metadata contains ' + key);
  }
  return value;
}

function frozenPointer(pointer: ComponentPointerV1): ComponentPointerV1 {
  const requires = {
    state_read: [...pointer.requires.state_read],
    event_subscribe: [...pointer.requires.event_subscribe],
    event_publish: [...pointer.requires.event_publish],
    call: [...pointer.requires.call],
    presentation: [...pointer.requires.presentation],
  };
  Object.freeze(requires.state_read);
  Object.freeze(requires.event_subscribe);
  Object.freeze(requires.event_publish);
  Object.freeze(requires.call);
  Object.freeze(requires.presentation);
  Object.freeze(requires);
  return Object.freeze({ ...pointer, requires });
}

function frozenState(
  highestAccepted: ComponentPointerV1,
  lastKnownGood?: ComponentPointerV1,
): ComponentReleaseState {
  const state: ComponentReleaseState = {
    schema: RELEASE_STATE_SCHEMA,
    home_id: highestAccepted.home_id,
    highest_accepted: frozenPointer(highestAccepted),
    ...(lastKnownGood === undefined ? {} : { last_known_good: frozenPointer(lastKnownGood) }),
  };
  return Object.freeze(state);
}

function sameRequirements(
  left: ComponentPointerV1['requires'],
  right: ComponentPointerV1['requires'],
): boolean {
  return (Object.keys(left) as Array<keyof ComponentPointerV1['requires']>).every((key) => (
    left[key].length === right[key].length
    && left[key].every((entry, index) => entry === right[key][index])
  ));
}

function samePointer(left: ComponentPointerV1, right: ComponentPointerV1): boolean {
  return left.schema === right.schema
    && left.home_id === right.home_id
    && left.generation === right.generation
    && left.release === right.release
    && left.abi === right.abi
    && left.url === right.url
    && left.sha256 === right.sha256
    && left.size === right.size
    && sameRequirements(left.requires, right.requires);
}

function pointerContext(
  context: PointerValidationContext,
  minimumGeneration?: number,
): PointerValidationContext {
  return {
    expectedHomeId: context.expectedHomeId,
    allowedArtifactOrigins: context.allowedArtifactOrigins,
    ...(context.allowedPathPrefixes === undefined
      ? {}
      : { allowedPathPrefixes: context.allowedPathPrefixes }),
    ...(minimumGeneration === undefined ? {} : { minimumGeneration }),
  };
}

export function validateReleaseState(
  value: unknown,
  context: PointerValidationContext,
): ComponentReleaseState {
  try {
    const record = ownExactKeys(
      value,
      ['schema', 'home_id', 'highest_accepted'],
      ['last_known_good'],
    );
    if (record.schema !== RELEASE_STATE_SCHEMA) {
      fail('release_metadata_invalid', 'release metadata has an unsupported schema');
    }
    if (record.home_id !== context.expectedHomeId) {
      fail('release_metadata_invalid', 'release metadata belongs to another home');
    }
    const highestAccepted = validatePointer(record.highest_accepted, pointerContext(context));
    const lastKnownGood = record.last_known_good === undefined
      ? undefined
      : validatePointer(record.last_known_good, pointerContext(context));
    if (lastKnownGood !== undefined && lastKnownGood.generation > highestAccepted.generation) {
      fail('release_metadata_invalid', 'last-known-good is newer than the anti-rollback floor');
    }
    if (
      lastKnownGood !== undefined
      && lastKnownGood.generation === highestAccepted.generation
      && !samePointer(lastKnownGood, highestAccepted)
    ) {
      fail('release_metadata_invalid', 'one generation has conflicting accepted metadata');
    }
    return frozenState(highestAccepted, lastKnownGood);
  } catch (error) {
    if (error instanceof ContractViolation && error.code !== 'release_metadata_invalid') {
      throw new ContractViolation('release_metadata_invalid', error.message);
    }
    throw error;
  }
}

export function acceptReleaseCandidate(
  current: ComponentReleaseState | undefined,
  value: unknown,
  context: PointerValidationContext,
  quarantinedDigests: ReadonlySet<string> = new Set(),
): ComponentReleaseState {
  const candidate = frozenPointer(validatePointer(
    value,
    pointerContext(context, current?.highest_accepted.generation),
  ));
  if (quarantinedDigests.has(candidate.sha256)) {
    fail('release_quarantined', 'candidate digest is quarantined');
  }
  if (current === undefined) return frozenState(candidate);
  if (candidate.generation === current.highest_accepted.generation) {
    if (!samePointer(candidate, current.highest_accepted)) {
      fail('pointer_invalid', 'the accepted generation was rewritten with different metadata');
    }
    return frozenState(current.highest_accepted, current.last_known_good);
  }
  return frozenState(candidate, current.last_known_good);
}

export function markReleaseActive(
  current: ComponentReleaseState,
  value: unknown,
  context: PointerValidationContext,
  quarantinedDigests: ReadonlySet<string> = new Set(),
): ComponentReleaseState {
  const candidate = frozenPointer(validatePointer(
    value,
    pointerContext(context, current.highest_accepted.generation),
  ));
  if (quarantinedDigests.has(candidate.sha256)) {
    fail('release_quarantined', 'candidate digest is quarantined');
  }
  if (!samePointer(candidate, current.highest_accepted)) {
    fail('pointer_invalid', 'only the highest accepted candidate can become last-known-good');
  }
  return frozenState(current.highest_accepted, candidate);
}

export function selectAutomaticFallback(
  current: ComponentReleaseState,
  failedCandidate: unknown,
  context: PointerValidationContext,
  options: AutomaticFallbackOptions,
): ComponentPointerV1 | undefined {
  const candidate = validatePointer(
    failedCandidate,
    pointerContext(context, current.highest_accepted.generation),
  );
  if (!samePointer(candidate, current.highest_accepted)) {
    fail('pointer_invalid', 'fallback candidate is not the highest accepted generation');
  }
  if (options.phase !== 'staging') return undefined;
  const fallback = current.last_known_good;
  if (fallback === undefined || samePointer(fallback, candidate)) return undefined;
  if (options.quarantinedDigests?.has(fallback.sha256)) return undefined;
  return frozenPointer(fallback);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    }, { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    }, { once: true });
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    }, { once: true });
  });
}

export class IndexedDbReleaseMetadataStore implements ReleaseMetadataStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(
    factory: IDBFactory = indexedDB,
    databaseName = DEFAULT_DATABASE_NAME,
  ) {
    const request = factory.open(databaseName, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(RELEASE_STORE)) {
        request.result.createObjectStore(RELEASE_STORE, { keyPath: 'home_id' });
      }
    });
    this.#database = requestResult(request);
  }

  async read(homeId: string): Promise<unknown | undefined> {
    const database = await this.#database;
    const transaction = database.transaction(RELEASE_STORE, 'readonly');
    const record = await requestResult(transaction.objectStore(RELEASE_STORE).get(homeId));
    await transactionComplete(transaction);
    return record;
  }

  async transact<T>(
    homeId: string,
    mutation: (current: unknown | undefined) => ReleaseMetadataMutation<T>,
  ): Promise<T> {
    const database = await this.#database;
    const transaction = database.transaction(RELEASE_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(RELEASE_STORE);
    const current = await requestResult(store.get(homeId));
    let result: ReleaseMetadataMutation<T>;
    try {
      result = mutation(current);
      if (result.record.home_id !== homeId) {
        fail('release_metadata_invalid', 'release metadata transaction changed its home key');
      }
      store.put(result.record);
    } catch (error) {
      transaction.abort();
      void completion.catch(() => undefined);
      throw error;
    }
    await completion;
    return result.value;
  }
}

export class ComponentReleaseLedger {
  readonly #context: PointerValidationContext;
  readonly #store: ReleaseMetadataStore;

  constructor(context: PointerValidationContext, store: ReleaseMetadataStore) {
    this.#context = pointerContext(context);
    this.#store = store;
  }

  async read(): Promise<ComponentReleaseState | undefined> {
    const current = await this.#store.read(this.#context.expectedHomeId);
    return current === undefined ? undefined : validateReleaseState(current, this.#context);
  }

  async accept(
    value: unknown,
    quarantinedDigests: ReadonlySet<string> = new Set(),
  ): Promise<ComponentReleaseState> {
    return this.#store.transact(this.#context.expectedHomeId, (stored) => {
      const current = stored === undefined
        ? undefined
        : validateReleaseState(stored, this.#context);
      const next = acceptReleaseCandidate(current, value, this.#context, quarantinedDigests);
      return { record: next, value: next };
    });
  }

  async markActive(
    value: unknown,
    quarantinedDigests: ReadonlySet<string> = new Set(),
  ): Promise<ComponentReleaseState> {
    return this.#store.transact(this.#context.expectedHomeId, (stored) => {
      if (stored === undefined) {
        fail('release_metadata_invalid', 'no accepted candidate exists');
      }
      const current = validateReleaseState(stored, this.#context);
      const next = markReleaseActive(current, value, this.#context, quarantinedDigests);
      return { record: next, value: next };
    });
  }

  async automaticFallback(
    failedCandidate: unknown,
    options: AutomaticFallbackOptions,
  ): Promise<ComponentPointerV1 | undefined> {
    const current = await this.read();
    if (current === undefined) return undefined;
    return selectAutomaticFallback(current, failedCandidate, this.#context, options);
  }
}
