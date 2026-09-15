import { describe, expect, test } from 'bun:test';
import {
  COMPONENT_ABI,
  ContractViolation,
  POINTER_SCHEMA,
  type ComponentPointerV1,
} from '../src/contract';
import {
  ComponentReleaseLedger,
  RELEASE_STATE_SCHEMA,
  acceptReleaseCandidate,
  markReleaseActive,
  selectAutomaticFallback,
  validateReleaseState,
  type ComponentReleaseState,
  type ReleaseMetadataMutation,
  type ReleaseMetadataStore,
} from '../src/release-state';

const artifactOrigin = 'https://artifacts.example';

function pointer(generation: number, sha256: string): ComponentPointerV1 {
  return {
    schema: POINTER_SCHEMA,
    home_id: 'home-test',
    generation,
    release: 'release-' + generation,
    abi: COMPONENT_ABI,
    url: artifactOrigin + '/homes/home-test/' + sha256 + '.js',
    sha256,
    size: 128,
    requires: {
      state_read: ['global.*'],
      event_subscribe: [],
      event_publish: [],
      call: ['lighting.set'],
      presentation: [],
    },
  };
}

const digest1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const digest2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const context = {
  expectedHomeId: 'home-test',
  allowedArtifactOrigins: new Set([artifactOrigin]),
  allowedPathPrefixes: ['/homes/'],
};

function state(
  highestAccepted: ComponentPointerV1,
  lastKnownGood?: ComponentPointerV1,
): ComponentReleaseState {
  return validateReleaseState({
    schema: RELEASE_STATE_SCHEMA,
    home_id: 'home-test',
    highest_accepted: highestAccepted,
    ...(lastKnownGood === undefined ? {} : { last_known_good: lastKnownGood }),
  }, context);
}

class MemoryStore implements ReleaseMetadataStore {
  record: unknown | undefined;

  async read(): Promise<unknown | undefined> {
    return this.record;
  }

  async transact<T>(
    _homeId: string,
    mutation: (current: unknown | undefined) => ReleaseMetadataMutation<T>,
  ): Promise<T> {
    const result = mutation(this.record);
    this.record = result.record;
    return result.value;
  }
}

describe('component release metadata', () => {
  test('raises the generation floor while retaining the last-known-good release', () => {
    const first = markReleaseActive(
      acceptReleaseCandidate(undefined, pointer(1, digest1), context),
      pointer(1, digest1),
      context,
    );
    const second = acceptReleaseCandidate(first, pointer(2, digest2), context);

    expect(second.highest_accepted).toMatchObject({ generation: 2, sha256: digest2 });
    expect(second.last_known_good).toMatchObject({ generation: 1, sha256: digest1 });
    expect(() => acceptReleaseCandidate(second, pointer(1, digest1), context))
      .toThrow(/anti-rollback floor/);
  });

  test('rejects equivocation within an already accepted generation', () => {
    const accepted = acceptReleaseCandidate(undefined, pointer(1, digest1), context);
    expect(() => acceptReleaseCandidate(accepted, pointer(1, digest2), context))
      .toThrow(/rewritten with different metadata/);
  });

  test('marks only the exact highest accepted pointer as last-known-good', () => {
    const accepted = acceptReleaseCandidate(
      state(pointer(1, digest1), pointer(1, digest1)),
      pointer(2, digest2),
      context,
    );
    expect(() => markReleaseActive(accepted, pointer(1, digest1), context))
      .toThrow(/anti-rollback floor/);
    expect(markReleaseActive(accepted, pointer(2, digest2), context).last_known_good)
      .toMatchObject({ generation: 2, sha256: digest2 });
    expect(() => markReleaseActive(
      accepted,
      pointer(2, digest2),
      context,
      new Set([digest2]),
    )).toThrow(/quarantined/);
  });

  test('allows automatic fallback only before effects and never to quarantine', () => {
    const accepted = state(pointer(2, digest2), pointer(1, digest1));
    expect(selectAutomaticFallback(accepted, pointer(2, digest2), context, {
      phase: 'staging',
    })).toMatchObject({ generation: 1, sha256: digest1 });
    expect(selectAutomaticFallback(accepted, pointer(2, digest2), context, {
      phase: 'effects_may_have_started',
    })).toBeUndefined();
    expect(selectAutomaticFallback(accepted, pointer(2, digest2), context, {
      phase: 'staging',
      quarantinedDigests: new Set([digest1]),
    })).toBeUndefined();
  });

  test('rejects quarantined candidates before advancing the floor', () => {
    expect(() => acceptReleaseCandidate(
      state(pointer(1, digest1), pointer(1, digest1)),
      pointer(2, digest2),
      context,
      new Set([digest2]),
    )).toThrow(new ContractViolation('release_quarantined', 'candidate digest is quarantined'));
  });

  test('fails closed on malformed persisted metadata', () => {
    expect(() => validateReleaseState({
      schema: RELEASE_STATE_SCHEMA,
      home_id: 'home-test',
      highest_accepted: pointer(2, digest2),
      last_known_good: pointer(3, digest1),
    }, context)).toThrow(/newer than/);
    expect(() => validateReleaseState({
      schema: RELEASE_STATE_SCHEMA,
      home_id: 'home-test',
      highest_accepted: pointer(2, digest2),
      last_known_good: pointer(2, digest1),
    }, context)).toThrow(/conflicting accepted metadata/);
    expect(() => validateReleaseState({
      schema: RELEASE_STATE_SCHEMA,
      home_id: 'home-test',
      highest_accepted: pointer(2, digest2),
      extra: true,
    }, context)).toThrow(/extra/);
  });

  test('ledger operations preserve atomic state and defensive copies', async () => {
    const store = new MemoryStore();
    const ledger = new ComponentReleaseLedger(context, store);
    const original = pointer(1, digest1);
    const accepted = await ledger.accept(original);
    original.requires.call[0] = 'door.open';
    await ledger.markActive(pointer(1, digest1));
    await ledger.accept(pointer(2, digest2));

    const read = await ledger.read();
    expect(read?.highest_accepted.generation).toBe(2);
    expect(read?.last_known_good?.requires.call).toEqual(['lighting.set']);
    expect(Object.isFrozen(accepted.highest_accepted.requires.call)).toBe(true);
  });
});
