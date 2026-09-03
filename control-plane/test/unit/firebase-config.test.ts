import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

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

interface PackageManifest {
  readonly engines: { readonly node: string };
  readonly scripts: { readonly 'test:emulator': string };
  readonly devDependencies: { readonly vitest: string };
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')) as T;
}

describe('Firebase deployment configuration', () => {
  test('uses no composite index and gives every expiring private record a TTL policy', () => {
    const config = fixture<FirestoreIndexes>('firestore.indexes.json');
    expect(config).toEqual({
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'pushChallenges',
        fieldPath: 'expires_at',
        ttl: true,
        indexes: [],
      }, {
        collectionGroup: 'controlAdmissionBuckets',
        fieldPath: 'expires_at',
        ttl: true,
        indexes: [],
      }, {
        collectionGroup: 'controlAudit',
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

  test('pins and verifies the stable Firestore Emulator before integration tests', () => {
    const checkScript = readFileSync(new URL('../../check.sh', import.meta.url), 'utf8');
    expect(checkScript).toContain("readonly FIRESTORE_EMULATOR_VERSION='1.19.4'");
    expect(checkScript).toContain("readonly FIRESTORE_EMULATOR_SIZE_BYTES='65913000'");
    expect(checkScript).toContain(
      "readonly FIRESTORE_EMULATOR_SHA256='15acd294f527ecd1ab1b109e2e037e6612c4e5f3d52eeff2f1c33651b3058429'",
    );
    expect(checkScript).toContain('firebase setup:emulators:firestore --non-interactive');
    expect(checkScript).toContain('Pinned Firestore Emulator integrity verification failed.');
  });

  test('runs Firestore integration tests on Node instead of Bun HTTP/2', () => {
    const manifest = fixture<PackageManifest>('package.json');
    const checkScript = readFileSync(new URL('../../check.sh', import.meta.url), 'utf8');
    expect(manifest.scripts['test:emulator']).toBe(
      'node ./node_modules/vitest/vitest.mjs run --no-file-parallelism test/emulator',
    );
    expect(manifest.engines.node).toBe('>=22.12.0 <23');
    expect(manifest.devDependencies.vitest).toBe('4.1.11');
    expect(checkScript).toContain('major === 22 && minor >= 12');
    expect(checkScript).toContain('node ./node_modules/vitest/vitest.mjs run --no-file-parallelism');
    expect(checkScript).not.toContain('bun test ./test/emulator');
    for (const name of readdirSync(new URL('../emulator/', import.meta.url))) {
      if (!name.endsWith('.test.ts')) continue;
      expect(readFileSync(new URL(`../emulator/${name}`, import.meta.url), 'utf8'))
        .toContain("from 'vitest'");
    }
  });

  test('gives every emulator scenario its own process boundary', () => {
    const checkScript = readFileSync(new URL('../../check.sh', import.meta.url), 'utf8');
    const admissionTests = readFileSync(
      new URL('../emulator/admission-vertical-slice.test.ts', import.meta.url),
      'utf8',
    );
    const block = /readonly -a ADMISSION_TEST_PATTERNS=\(\n([\s\S]*?)\n\)/u.exec(checkScript)?.[1];
    expect(block).toBeDefined();
    const isolatedPatterns = [...(block ?? '').matchAll(/^\s+'([^']+)'$/gmu)]
      .map((match) => match[1]);
    const declaredScenarios = [...admissionTests.matchAll(/^\s+test\('([^']+)'/gmu)]
      .map((match) => match[1]);
    expect(isolatedPatterns).toEqual(declaredScenarios);

    const fileBlock = /readonly -a EMULATOR_TEST_FILES=\(\n([\s\S]*?)\n\)/u.exec(checkScript)?.[1];
    expect(fileBlock).toBeDefined();
    const isolatedFiles = [...(fileBlock ?? '').matchAll(/^\s+'([^']+)'$/gmu)]
      .map((match) => match[1])
      .sort();
    const declaredFiles = readdirSync(new URL('../emulator/', import.meta.url))
      .filter((name) => name.endsWith('.test.ts') && name !== 'admission-vertical-slice.test.ts')
      .map((name) => `test/emulator/${name}`)
      .sort();
    expect(isolatedFiles).toEqual(declaredFiles);
  });
});
