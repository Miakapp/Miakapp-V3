import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

interface FirestoreIndexes {
  readonly indexes: readonly unknown[];
  readonly fieldOverrides: readonly {
    readonly collectionGroup: string;
    readonly fieldPath: string;
    readonly ttl: boolean;
    readonly indexes: readonly unknown[];
  }[];
}

interface FirebaseConfig {
  readonly functions: readonly [{ readonly ignore: readonly string[] }];
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')) as T;
}

describe('Firebase deployment configuration', () => {
  test('uses no composite index and gives expired push challenges a production TTL policy', () => {
    const config = fixture<FirestoreIndexes>('firestore.indexes.json');
    expect(config).toEqual({
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'pushChallenges',
        fieldPath: 'expires_at',
        ttl: true,
        indexes: [],
      }],
    });
  });

  test('excludes local dependencies, tests, and generated emulator logs from Functions uploads', () => {
    const config = fixture<FirebaseConfig>('firebase.json');
    expect(config.functions[0].ignore).toEqual(expect.arrayContaining([
      '.firebase',
      '.git',
      '*-debug.log',
      '*-debug.*.log',
      '*.local',
      'node_modules',
      'test',
    ]));
  });
});
