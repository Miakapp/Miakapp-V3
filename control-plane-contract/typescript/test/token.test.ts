import { describe, expect, test } from 'bun:test';

import {
  TokenVerificationError,
  loadAccessTokenFixture,
  tokenErrorCode,
  verifyFixtureVector,
  verifyMiakappAccessToken,
  type PublicJwk,
} from '../src/index.js';

describe('shared signed token vectors', () => {
  test('accepts and rejects every vector with its exact profile result', async () => {
    const fixture = await loadAccessTokenFixture();
    for (const vector of fixture.vectors) {
      if (vector.valid) {
        if (vector.expected === undefined) throw new Error(`${vector.id} lacks expected evidence`);
        expect(verifyFixtureVector(vector, fixture), vector.id).toEqual(vector.expected);
      } else {
        try {
          verifyFixtureVector(vector, fixture);
          throw new Error(`${vector.id} was accepted`);
        } catch (error) {
          expect(tokenErrorCode(error), vector.id).toBe(vector.error);
        }
      }
    }
  });

  test('rejects a valid token when presented to another resource profile', async () => {
    const fixture = await loadAccessTokenFixture();
    const coordinator = fixture.vectors.find((vector) => vector.id === 'valid_coordinator');
    if (coordinator === undefined) throw new Error('fixture vector missing');
    expect(() => verifyMiakappAccessToken(
      coordinator.token,
      fixture,
      'push',
      fixture.key_sets.initial.keys,
    )).toThrow(TokenVerificationError);
    try {
      verifyMiakappAccessToken(coordinator.token, fixture, 'push', fixture.key_sets.initial.keys);
    } catch (error) {
      expect(tokenErrorCode(error)).toBe('invalid_audience');
    }
  });

  test('does not trust contradictory JWK usage metadata', async () => {
    const fixture = await loadAccessTokenFixture();
    const coordinator = fixture.vectors.find((vector) => vector.id === 'valid_coordinator');
    if (coordinator === undefined) throw new Error('fixture vector missing');
    const contradictory = fixture.key_sets.initial.keys.map((key, index) => (
      index === 0 ? { ...key, use: 'enc' } as unknown as PublicJwk : key
    ));
    try {
      verifyMiakappAccessToken(coordinator.token, fixture, 'coordinator', contradictory);
      throw new Error('contradictory JWK was accepted');
    } catch (error) {
      expect(tokenErrorCode(error)).toBe('invalid_header');
    }
  });
});
