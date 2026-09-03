import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STAGING_CONTROL_PLANE_OPTIONS,
  controlPlane,
} from '../../src/production-entrypoint.js';

interface FunctionEndpoint {
  readonly platform: string;
  readonly omit: boolean;
  readonly region: readonly string[];
  readonly minInstances: number;
  readonly maxInstances: number;
  readonly concurrency: number;
  readonly timeoutSeconds: number;
  readonly serviceAccountEmail: string;
  readonly httpsTrigger: Readonly<{ readonly invoker: readonly string[] }>;
}

interface FunctionTrigger {
  readonly platform: string;
  readonly regions: readonly string[];
  readonly httpsTrigger: Readonly<{
    readonly allowInsecure: boolean;
    readonly invoker: readonly string[];
  }>;
}

function resolveLocalSource(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = resolve(dirname(importer), specifier);
  const candidates = [
    resolved.endsWith('.js') ? `${resolved.slice(0, -3)}.ts` : resolved,
    `${resolved}.ts`,
    resolve(resolved, 'index.ts'),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (source === undefined) {
    throw new Error(`Cannot resolve local source import ${specifier}`);
  }
  return source;
}

function reachableRuntimeSources(entry: string): ReadonlySet<string> {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const reachable = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (sourcePath === undefined || reachable.has(sourcePath)) continue;
    reachable.add(sourcePath);
    const source = readFileSync(sourcePath, 'utf8');
    const imports = transpiler.scanImports(source);
    for (const imported of imports) {
      const dependency = resolveLocalSource(sourcePath, imported.path);
      if (dependency !== undefined && !reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

describe('inactive staging production entrypoint', () => {
  test('pins a private omitted Gen 2 Function without choosing an ingress path', () => {
    expect(STAGING_CONTROL_PLANE_OPTIONS).toEqual({
      region: 'europe-west9',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 16,
      timeoutSeconds: 30,
      serviceAccount: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      cors: false,
      invoker: 'private',
      omit: true,
    });
    expect('ingressSettings' in STAGING_CONTROL_PLANE_OPTIONS).toBe(false);
    expect('secrets' in STAGING_CONTROL_PLANE_OPTIONS).toBe(false);

    const endpoint = (controlPlane as unknown as { readonly __endpoint: FunctionEndpoint }).__endpoint;
    const trigger = (controlPlane as unknown as { readonly __trigger: FunctionTrigger }).__trigger;
    expect(endpoint).toMatchObject({
      platform: 'gcfv2',
      omit: true,
      region: ['europe-west9'],
      minInstances: 0,
      maxInstances: 1,
      concurrency: 16,
      timeoutSeconds: 30,
      serviceAccountEmail: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
      httpsTrigger: { invoker: ['private'] },
    });
    expect(trigger).toMatchObject({
      platform: 'gcfv2',
      regions: ['europe-west9'],
      httpsTrigger: { allowInsecure: false, invoker: ['private'] },
    });
  });

  test('remains unreachable from the deployed emulator entrypoint and Firebase codebase', () => {
    const indexPath = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
    const graph = reachableRuntimeSources(indexPath);
    expect(graph).toContain(fileURLToPath(new URL('../../src/api.ts', import.meta.url)));
    for (const forbidden of [
      'production-entrypoint.ts',
      'production-function-runtime.ts',
      'production-runtime-loader.ts',
      'production-runtime.ts',
    ]) {
      expect(graph).not.toContain(fileURLToPath(new URL(`../../src/${forbidden}`, import.meta.url)));
    }

    const firebase = JSON.parse(readFileSync(
      new URL('../../firebase.json', import.meta.url),
      'utf8',
    )) as Readonly<Record<string, unknown>>;
    const packageDocument = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    )) as Readonly<Record<string, unknown>>;

    expect(packageDocument.main).toBe('lib/index.js');
    expect(firebase).toMatchObject({
      functions: [{ source: '.', codebase: 'control-plane-emulator' }],
    });
  });
});
