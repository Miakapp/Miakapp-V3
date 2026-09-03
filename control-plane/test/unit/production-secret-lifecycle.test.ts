import { describe, expect, test } from 'bun:test';

import type {
  PinnedSecretKeyringConfig,
  PinnedSecretVersionReference,
} from '../../src/production-config.js';
import {
  classifyProductionSecretKeyringsTransition,
  classifyProductionSecretLifecycleTransition,
  ProductionSecretLifecycleError,
} from '../../src/production-secret-lifecycle.js';

const SECRET_BASE = 'projects/miakapp-v4-staging/secrets/miakapp-home-key-pepper';

function reference(
  logicalVersion: string,
  resourceVersion: string,
  resourceBase = SECRET_BASE,
): PinnedSecretVersionReference {
  return {
    logicalVersion,
    resourceName: `${resourceBase}/versions/${resourceVersion}`,
  };
}

function keyring(
  currentVersion: string,
  versions: readonly PinnedSecretVersionReference[],
): PinnedSecretKeyringConfig {
  return { currentVersion, versions };
}

function asKeyring(value: unknown): PinnedSecretKeyringConfig {
  return value as PinnedSecretKeyringConfig;
}

function expectInvalid(
  previous: PinnedSecretKeyringConfig | undefined,
  next: PinnedSecretKeyringConfig,
): void {
  let thrown: unknown;
  try {
    classifyProductionSecretLifecycleTransition(previous, next);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProductionSecretLifecycleError);
  expect(thrown).toMatchObject({
    message: 'Production secret lifecycle transition is invalid',
  });
}

function keyrings(resourceVersion = '1') {
  return {
    homeKeyPepper: keyring('v1', [reference('v1', resourceVersion)]),
    componentHmac: keyring('v1', [reference(
      'v1',
      resourceVersion,
      'projects/miakapp-v4-staging/secrets/miakapp-component-hmac',
    )]),
    pushHmac: keyring('v1', [reference(
      'v1',
      resourceVersion,
      'projects/miakapp-v4-staging/secrets/miakapp-push-hmac',
    )]),
    auditHmac: keyring('v1', [reference(
      'v1',
      resourceVersion,
      'projects/miakapp-v4-staging/secrets/miakapp-audit-hmac',
    )]),
    networkHmac: keyring('v1', [reference(
      'v1',
      resourceVersion,
      'projects/miakapp-v4-staging/secrets/miakapp-network-hmac',
    )]),
  };
}

describe('production secret lifecycle', () => {
  test('initializes with exactly one current pinned numeric version', () => {
    expect(classifyProductionSecretLifecycleTransition(
      undefined,
      keyring('initial', [reference('initial', '1')]),
    )).toBe('initialize');

    expect(classifyProductionSecretLifecycleTransition(
      undefined,
      keyring('adopted', [reference('adopted', '18446744073709551615')]),
    )).toBe('initialize');

    expectInvalid(undefined, keyring('v1', [reference('v1', '1'), reference('v2', '2')]));
  });

  test('prepares one later version without changing the current version', () => {
    const previous = keyring('v1', [reference('v1', '7')]);
    const next = keyring('v1', [reference('v2', '8'), reference('v1', '7')]);
    const previousSnapshot = structuredClone(previous);
    const nextSnapshot = structuredClone(next);

    expect(classifyProductionSecretLifecycleTransition(previous, next)).toBe('prepare');
    expect(previous).toEqual(previousSnapshot);
    expect(next).toEqual(nextSnapshot);
  });

  test('activates either retained version without changing the prepared set', () => {
    const prepared = keyring('v1', [reference('v1', '7'), reference('v2', '8')]);
    const active = keyring('v2', [reference('v2', '8'), reference('v1', '7')]);

    expect(classifyProductionSecretLifecycleTransition(prepared, active)).toBe('activate');
    expect(classifyProductionSecretLifecycleTransition(active, prepared)).toBe('activate');
  });

  test('retires only the retained non-current version', () => {
    const active = keyring('v2', [reference('v1', '7'), reference('v2', '8')]);
    expect(classifyProductionSecretLifecycleTransition(
      active,
      keyring('v2', [reference('v2', '8')]),
    )).toBe('retire');

    const rolledBack = keyring('v1', [reference('v1', '7'), reference('v2', '8')]);
    expect(classifyProductionSecretLifecycleTransition(
      rolledBack,
      keyring('v1', [reference('v1', '7')]),
    )).toBe('retire');
  });

  test('treats order-only permutations as no-ops', () => {
    const one = keyring('v1', [reference('v1', '7')]);
    expect(classifyProductionSecretLifecycleTransition(one, structuredClone(one))).toBe('no-op');

    expect(classifyProductionSecretLifecycleTransition(
      keyring('v2', [reference('v1', '7'), reference('v2', '8')]),
      keyring('v2', [reference('v2', '8'), reference('v1', '7')]),
    )).toBe('no-op');
  });

  test('rejects malformed or ambiguous keyrings before classifying a transition', () => {
    const malformed: unknown[] = [
      null,
      {},
      { currentVersion: 1, versions: [reference('v1', '1')] },
      { currentVersion: 'v1', versions: [] },
      { currentVersion: 'missing', versions: [reference('v1', '1')] },
      {
        currentVersion: 'v1',
        versions: [reference('v1', '1')],
        unreviewed: true,
      },
      keyring('v1', [reference('v1', '1'), reference('v1', '2')]),
      keyring('v1', [reference('v1', '1'), reference('v2', '1')]),
      keyring('v1', [reference('v1', '1'), reference('v2', '2'), reference('v3', '3')]),
      keyring('bad version', [reference('bad version', '1')]),
      {
        currentVersion: 'v1',
        versions: [{ ...reference('v1', '1'), unreviewed: true }],
      },
      keyring('v1', [reference('v1', 'latest')]),
      keyring('v1', [reference('v1', '0')]),
      keyring('v1', [reference('v1', '01')]),
      keyring('v1', [reference('v1', '9'.repeat(512))]),
      keyring('v1', [{ logicalVersion: 'v1', resourceName: 'secret-material' }]),
      keyring('v1', [
        reference('v1', '1'),
        reference('v2', '2', 'projects/miakapp-v4-staging/secrets/miakapp-component-hmac'),
      ]),
    ];

    for (const candidate of malformed) {
      expectInvalid(undefined, asKeyring(candidate));
    }

    expectInvalid(
      asKeyring({ currentVersion: 'v1', versions: [] }),
      keyring('v1', [reference('v1', '1')]),
    );
  });

  test('rejects skipped, combined, backwards, and replacement transitions', () => {
    const initial = keyring('v1', [reference('v1', '7')]);
    const prepared = keyring('v1', [reference('v1', '7'), reference('v2', '8')]);

    const invalidNext: PinnedSecretKeyringConfig[] = [
      keyring('v2', [reference('v1', '7'), reference('v2', '8')]),
      keyring('v1', [reference('v1', '7'), reference('v2', '6')]),
      keyring('v1', [reference('v1', '8')]),
      keyring('v2', [reference('v2', '8')]),
      keyring('v1', [
        reference('v1', '7'),
        reference('v2', '8', 'projects/miakapp-v4-staging/secrets/miakapp-component-hmac'),
      ]),
    ];
    for (const next of invalidNext) expectInvalid(initial, next);

    expectInvalid(
      prepared,
      keyring('v1', [reference('v1', '7'), reference('v3', '9')]),
    );
    expectInvalid(
      keyring('v2', [reference('v1', '7'), reference('v2', '8')]),
      keyring('v1', [reference('v1', '7')]),
    );
    expectInvalid(
      prepared,
      keyring('v1', [
        reference('v1', '7', 'projects/miakapp-v4-staging/secrets/miakapp-component-hmac'),
      ]),
    );
  });

  test('initializes all purposes together but rotates only one purpose per transition', () => {
    const initial = keyrings();
    expect(classifyProductionSecretKeyringsTransition(undefined, initial)).toEqual({
      transition: 'initialize',
      purposes: ['homeKeyPepper', 'componentHmac', 'pushHmac', 'auditHmac', 'networkHmac'],
    });
    expect(classifyProductionSecretKeyringsTransition(initial, structuredClone(initial))).toEqual({
      transition: 'no-op',
      purposes: [],
    });

    const onePrepared = structuredClone(initial);
    onePrepared.pushHmac = keyring('v1', [
      ...onePrepared.pushHmac.versions,
      reference(
        'v2',
        '2',
        'projects/miakapp-v4-staging/secrets/miakapp-push-hmac',
      ),
    ]);
    expect(classifyProductionSecretKeyringsTransition(initial, onePrepared)).toEqual({
      transition: 'prepare',
      purposes: ['pushHmac'],
    });

    const twoPrepared = structuredClone(onePrepared);
    twoPrepared.auditHmac = keyring('v1', [
      ...twoPrepared.auditHmac.versions,
      reference(
        'v2',
        '2',
        'projects/miakapp-v4-staging/secrets/miakapp-audit-hmac',
      ),
    ]);
    expect(() => classifyProductionSecretKeyringsTransition(initial, twoPrepared))
      .toThrow(ProductionSecretLifecycleError);

    const swapped = structuredClone(initial);
    [swapped.homeKeyPepper, swapped.componentHmac] = [
      swapped.componentHmac,
      swapped.homeKeyPepper,
    ];
    expect(() => classifyProductionSecretKeyringsTransition(undefined, swapped))
      .toThrow(ProductionSecretLifecycleError);

    const crossProject = structuredClone(initial);
    crossProject.networkHmac = keyring('v1', [reference(
      'v1',
      '1',
      'projects/miakapp-v4/secrets/miakapp-network-hmac',
    )]);
    expect(() => classifyProductionSecretKeyringsTransition(undefined, crossProject))
      .toThrow(ProductionSecretLifecycleError);
  });
});
