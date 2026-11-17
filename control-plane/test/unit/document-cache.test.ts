import { describe, expect, test } from 'bun:test';

import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';

import { DocumentCache } from '../../src/document-cache.js';

function reference(path: string) {
  let reads = 0;
  let version = 0;
  let release: (() => void) | null = null;
  let held = false;
  const ref = {
    path,
    get: async () => {
      reads += 1;
      const seen = version;
      if (held) await new Promise<void>((resolve) => { release = resolve; });
      return { exists: seen > 0, version: seen } as unknown as DocumentSnapshot;
    },
  } as unknown as DocumentReference;
  return {
    ref,
    reads: () => reads,
    write: () => { version += 1; },
    hold: () => { held = true; },
    release: () => { held = false; release?.(); },
  };
}

const versionOf = (snapshot: DocumentSnapshot) => (snapshot as unknown as { version: number }).version;

describe('document cache', () => {
  test('serves a document from memory until it expires', async () => {
    let now = 1_000;
    const cache = new DocumentCache({ ttlMs: 600_000, now: () => now });
    const doc = reference('controlHomes/colmon');
    doc.write();
    await cache.get(doc.ref);
    await cache.get(doc.ref);
    expect(doc.reads()).toBe(1);
    now += 599_999;
    await cache.get(doc.ref);
    expect(doc.reads()).toBe(1);
    now += 1;
    await cache.get(doc.ref);
    expect(doc.reads()).toBe(2);
  });

  test('caches a missing document too', async () => {
    const cache = new DocumentCache({ ttlMs: 60_000 });
    const doc = reference('controlHomes/deleted');
    expect((await cache.get(doc.ref)).exists).toBe(false);
    expect((await cache.get(doc.ref)).exists).toBe(false);
    expect(doc.reads()).toBe(1);
  });

  test('a clear makes the next read fresh', async () => {
    const cache = new DocumentCache({ ttlMs: 60_000 });
    const doc = reference('homeKeyIndex/k');
    doc.write();
    expect(versionOf(await cache.get(doc.ref))).toBe(1);
    doc.write();
    cache.clear();
    expect(versionOf(await cache.get(doc.ref))).toBe(2);
    expect(doc.reads()).toBe(2);
  });

  test('a read in flight during a clear does not fill the cache', async () => {
    const cache = new DocumentCache({ ttlMs: 60_000 });
    const doc = reference('components/colmon');
    doc.write();
    doc.hold();
    const stale = cache.get(doc.ref);
    doc.write();
    cache.clear();
    doc.release();
    expect(versionOf(await stale)).toBe(1);
    expect(versionOf(await cache.get(doc.ref))).toBe(2);
    expect(doc.reads()).toBe(2);
  });

  test('shares one read between concurrent callers', async () => {
    const cache = new DocumentCache({ ttlMs: 60_000 });
    const doc = reference('homes/colmon');
    await Promise.all([cache.get(doc.ref), cache.get(doc.ref), cache.get(doc.ref)]);
    expect(doc.reads()).toBe(1);
  });

  test('disabled, it reads every time', async () => {
    const cache = DocumentCache.disabled();
    const doc = reference('homes/colmon');
    await cache.get(doc.ref);
    await cache.get(doc.ref);
    expect(doc.reads()).toBe(2);
  });

  test('stays bounded', async () => {
    const cache = new DocumentCache({ ttlMs: 60_000, maxEntries: 2 });
    const a = reference('homes/a');
    const b = reference('homes/b');
    const c = reference('homes/c');
    await cache.get(a.ref);
    await cache.get(b.ref);
    await cache.get(c.ref);
    await cache.get(c.ref);
    await cache.get(b.ref);
    await cache.get(a.ref);
    expect([a.reads(), b.reads(), c.reads()]).toEqual([2, 1, 1]);
  });
});
