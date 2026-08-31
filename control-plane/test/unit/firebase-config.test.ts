import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

interface FirestoreIndexes {
  readonly indexes: readonly unknown[];
  readonly fieldOverrides: readonly unknown[];
}

interface FirebaseConfig {
  readonly functions: readonly [{ readonly ignore: readonly string[] }];
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')) as T;
}

describe('Firebase deployment configuration', () => {
  test('declares no composite index after bounded registry sorting moved in memory', () => {
    const config = fixture<FirestoreIndexes>('firestore.indexes.json');
    expect(config).toEqual({ indexes: [], fieldOverrides: [] });
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
