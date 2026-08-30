import { describe, expect, test } from 'bun:test';
import {
  EventDirection,
  ApplicationCallError,
  type CallTarget,
  type CoordinatorConfiguration,
  type CoordinatorFactory,
  type CoordinatorModule,
  type CoordinatorOptions,
  type EventTarget,
  type ProtocolValue,
  type StateMutation,
} from '../src/index.js';

describe('normative public API types', () => {
  test('keeps the event direction bits aligned with RFC 0001', () => {
    expect(EventDirection).toEqual({
      acceptFromUsers: 0x01,
      publishToUsers: 0x02,
      acceptFromCoordinators: 0x04,
      publishToCoordinators: 0x08,
    });
    expect(Object.isFrozen(EventDirection)).toBe(true);
  });

  test('accepts the documented dynamic values and state mutations at compile time', () => {
    const value: ProtocolValue = {
      binary: Uint8Array.of(1, 2, 3),
      nested: [null, true, 42, 1.5, 'value'],
    };
    const mutations: StateMutation[] = [
      { path: 'zone.alpha.light.on', value: true },
      { path: 'zone.alpha.legacy', delete: true },
    ];
    expect(value).toBeDefined();
    expect(mutations).toHaveLength(2);
  });

  test('defines construction as an injected factory boundary', () => {
    const options: CoordinatorOptions = {
      name: 'main',
      accessTokenProvider: {
        getAccessToken: async () => ({
          relayUrl: 'wss://relay.invalid/ws',
          token: 'synthetic-token',
          expiresAtMs: 4_102_444_800_000,
        }),
      },
    };
    const acceptsFactory = (_factory: CoordinatorFactory): void => undefined;
    const acceptsModule = (_module: CoordinatorModule): void => undefined;
    expect(() => acceptsFactory).not.toThrow();
    expect(() => acceptsModule).not.toThrow();
    expect(options.name).toBe('main');
  });

  test('defines one complete synchronous bootstrap configuration', () => {
    const configuration: CoordinatorConfiguration = {
      state: {},
      stateAccess: [],
      events: [],
      eventAccess: [],
      functions: {},
    };
    expect(Object.keys(configuration).sort()).toEqual([
      'eventAccess',
      'events',
      'functions',
      'state',
      'stateAccess',
    ]);
  });

  test('keeps targets discriminated at compile time', () => {
    const eventTarget: EventTarget = { kind: 'user_session', id: 42 };
    const callTarget: CallTarget = { kind: 'coordinator', id: 'secondary' };
    // @ts-expect-error default routes never carry an ID
    const invalidDefault: EventTarget = { kind: 'default', id: 42 };
    // @ts-expect-error user sessions require a numeric ID
    const invalidSession: CallTarget = { kind: 'user_session', id: '42' };
    expect(eventTarget.kind).toBe('user_session');
    expect(callTarget.kind).toBe('coordinator');
    expect(invalidDefault).toBeDefined();
    expect(invalidSession).toBeDefined();
  });

  test('reserves sanitized application call errors', () => {
    const error = new ApplicationCallError(2_001, 'Synthetic application failure');
    expect(error).toMatchObject({
      name: 'ApplicationCallError',
      code: 2_001,
      retryable: false,
    });
    expect(() => new ApplicationCallError(1_500)).toThrow(RangeError);
    expect(() => new ApplicationCallError(2_001, '\ud800')).toThrow(TypeError);
    expect(() => new ApplicationCallError(
      2_001,
      'Synthetic application failure',
      'yes' as never,
    )).toThrow(TypeError);
  });
});
