import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  ContractViolation,
  type JsonValue,
  deriveHomeKeyVerifier,
  homeKeyVerifierMatches,
  loadAccessTokenFixture,
  parseBoundedJson,
  parseHomeKey,
  validateAccessTokenFixture,
} from '../src/index.js';

const fixtureLimits = {
  maximumBytes: 262_144,
  maximumDepth: 16,
  maximumValues: 8_192,
  maximumStringBytes: 16_384,
  maximumArrayItems: 256,
  maximumObjectEntries: 256,
};

async function mutableFixture(): Promise<{ [key: string]: JsonValue }> {
  const parsed = parseBoundedJson(
    await readFile(new URL('../../fixtures/v1/access-tokens.json', import.meta.url)),
    fixtureLimits,
  );
  return JSON.parse(JSON.stringify(parsed)) as { [key: string]: JsonValue };
}

describe('access-token fixture contract', () => {
  test('loads the synthetic profile and validates Home Key evidence', async () => {
    const fixture = await loadAccessTokenFixture();
    const parsed = parseHomeKey(fixture.home_key.value);
    expect(parsed.keyId).toBe(fixture.home_key.key_id);
    expect(parsed.secret.byteLength).toBe(32);
    const pepper = Buffer.from(fixture.home_key.pepper_base64url, 'base64url');
    expect(deriveHomeKeyVerifier(fixture.home_key.value, pepper))
      .toBe(fixture.home_key.verifier_base64url);
    expect(homeKeyVerifierMatches(fixture.home_key.value, pepper, fixture.home_key.verifier_base64url))
      .toBe(true);
    expect(createHmac('sha256', pepper).update(fixture.home_key.value, 'ascii').digest('base64url'))
      .toBe(fixture.home_key.verifier_base64url);
  });

  test('rejects every malformed Home Key without echoing it', async () => {
    const fixture = await loadAccessTokenFixture();
    for (const key of fixture.home_key.malformed) {
      try {
        parseHomeKey(key);
        throw new Error('accepted malformed Home Key');
      } catch (error) {
        expect(error).toBeInstanceOf(ContractViolation);
        expect(String(error)).not.toContain(key || 'empty-key-sentinel');
      }
    }
  });

  test('requires every named signed-vector class', async () => {
    const raw = await mutableFixture();
    raw.vectors = (raw.vectors as JsonValue[]).filter((entry) => (
      (entry as { [key: string]: JsonValue }).id !== 'algorithm_none'
    ));
    expect(() => validateAccessTokenFixture(raw)).toThrow(/fixture lacks algorithm_none/);
  });

  test.each([
    ['prepublication', 59, 330],
    ['retiring retention', 60, 329],
  ])('rejects an unsafe %s rotation interval', async (_label, prepublication, retention) => {
    const raw = await mutableFixture();
    const rotation = raw.rotation as Record<string, JsonValue>;
    const transitions = rotation.transitions as Array<Record<string, JsonValue>>;
    const prepublishedAt = transitions[1]!.at as number;
    transitions[2]!.at = prepublishedAt + prepublication;
    rotation.retiring_last_issued_at = transitions[2]!.at;
    transitions[3]!.at = (rotation.retiring_last_issued_at as number) + retention;
    expect(() => validateAccessTokenFixture(raw)).toThrow(/rotation timing/);
  });

  test('requires the future signing key to be prepublished before activation', async () => {
    const raw = await mutableFixture();
    const keySets = raw.key_sets as Record<string, Record<string, JsonValue>>;
    const prepublished = keySets.prepublished!.keys as JsonValue[];
    prepublished.pop();
    expect(() => validateAccessTokenFixture(raw)).toThrow(/rotation key-set membership/);
  });

  test('retires the actual pre-activation signing key', async () => {
    const raw = await mutableFixture();
    const rotation = raw.rotation as Record<string, JsonValue>;
    const transitions = rotation.transitions as Record<string, JsonValue>[];
    rotation.retiring_kid = transitions[2]!.signing_kid!;
    expect(() => validateAccessTokenFixture(raw)).toThrow(/rotation timing/);
  });

  test('derives every access-vector key set from the rotation clock', async () => {
    const raw = await mutableFixture();
    const rotation = raw.rotation as Record<string, JsonValue>;
    const transitions = rotation.transitions as Record<string, JsonValue>[];
    for (const transition of transitions) transition.at = (transition.at as number) + 10_000;
    rotation.retiring_last_issued_at = (rotation.retiring_last_issued_at as number) + 10_000;
    expect(() => validateAccessTokenFixture(raw)).toThrow(/rotation timeline|clock-derived key set/);
  });

  test('requires both Firebase key sources to be byte-for-byte identical', async () => {
    const raw = await mutableFixture();
    const firebase = raw.firebase as Record<string, JsonValue>;
    (firebase.public_keys as JsonValue[]).pop();
    expect(() => validateAccessTokenFixture(raw)).toThrow(/key sources disagree/);
  });

  test('keeps access-token and Firebase signing algorithms in separate key sets', async () => {
    const raw = await mutableFixture();
    const keySets = raw.key_sets as Record<string, Record<string, JsonValue>>;
    const firebaseKeys = keySets.firebase!.keys as JsonValue[];
    (keySets.initial!.keys as JsonValue[]).push(firebaseKeys[0]!);
    expect(() => validateAccessTokenFixture(raw)).toThrow(/non-Ed25519 access-token key/);
  });

  test('derives RSA and JSON-limit evidence from signed vector contents', async () => {
    const raw = await mutableFixture();
    const vectors = raw.vectors as Record<string, JsonValue>[];
    const rsa2048 = vectors.find((entry) => entry.id === 'valid_firebase_verified_email');
    const rsa3072Index = vectors.findIndex((entry) => entry.id === 'valid_firebase_rs256_3072');
    if (rsa2048 === undefined || rsa3072Index < 0) throw new Error('RSA evidence missing');
    vectors[rsa3072Index] = { ...rsa2048, id: 'valid_firebase_rs256_3072' };
    expect(() => validateAccessTokenFixture(raw)).toThrow(/does not exercise RSA-3072/);
  });

  test('does not allow the Google issuer host in deployment-controlled URLs', async () => {
    const raw = await mutableFixture();
    const deployment = raw.deployment as Record<string, JsonValue>;
    deployment.exchange_endpoint = 'https://securetoken.google.com/exchange';
    expect(() => validateAccessTokenFixture(raw)).toThrow(/synthetic .test host/);
  });
});
