import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { BLOCKED_NAVIGATOR_MEMBERS, BLOCKED_WORKER_GLOBALS } from '../src/security-profile';

const hostUrl = 'http://127.0.0.1:4173/host.html';

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

async function mount(page: import('@playwright/test').Page, source: string, options: Record<string, unknown> = {}) {
  return page.evaluate(async ({ artifact, mountOptions }) => {
    const harness = (window as typeof window & { runtimeHarness: { mountSource: Function } }).runtimeHarness;
    return harness.mountSource(artifact, mountOptions);
  }, { artifact: source, mountOptions: options });
}

async function status(page: import('@playwright/test').Page) {
  return page.evaluate(() => (
    (window as typeof window & { runtimeHarness: { status: Function } }).runtimeHarness.status()
  ));
}

test.beforeEach(async ({ page }) => {
  await page.goto(hostUrl);
});

test('stores isolated defensive copies in the trusted IndexedDB cache', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = '/artifact-cache.js';
    const { IndexedDbArtifactCache } = await import(moduleUrl);
    const cache = new IndexedDbArtifactCache();
    const home = `home-${crypto.randomUUID()}`;
    const digest = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const original = Uint8Array.from([1, 2, 3, 4]);

    await cache.put(home, digest, original);
    original[0] = 99;
    const first = await cache.get(home, digest);
    if (first === undefined) throw new Error('missing cached artifact');
    first[1] = 88;
    const second = await cache.get(home, digest);
    await cache.delete(home, digest);
    const deleted = await cache.get(home, digest);

    return {
      first: Array.from(first),
      second: second === undefined ? undefined : Array.from(second),
      deleted: deleted === undefined,
    };
  });

  expect(result).toEqual({
    first: [1, 88, 3, 4],
    second: [1, 2, 3, 4],
    deleted: true,
  });
});

test('renders a valid tree and preserves RFC 0001 call states', async ({ page }) => {
  const result = await mount(page, await fixture('good.mjs'));
  expect(result.lifecycle, JSON.stringify(result)).toBe('active');
  await expect(page.getByRole('heading', { name: 'Test home' })).toBeVisible();
  await expect(page.getByText('Temperature: 21.5')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle light' }).click();
  await expect.poll(async () => (await status(page)).calls.length).toBe(1);
  await expect(page.locator('[role="status"][data-state="applied"]')).toContainText('Light operation');
  expect((await status(page)).calls[0]).toMatchObject({ name: 'lighting.set' });
});

test('never starts bytes rejected by host or broker integrity checks', async ({ page }) => {
  const source = await fixture('good.mjs');
  const hostRejected = await mount(page, source, {
    hashOverride: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  expect(hostRejected.lifecycle).toBe('failed');
  expect(hostRejected.errors[0].code).toBe('artifact_hash_mismatch');

  await page.reload();
  const brokerRejected = await mount(page, source, { tamperAfterHostVerification: true });
  expect(brokerRejected.lifecycle).toBe('failed');
  expect(brokerRejected.errors[0].code).toBe('artifact_hash_mismatch');
});

test('rejects a second load while the first verification is pending', async ({ page }) => {
  const result = await mount(page, await fixture('good.mjs'), { duplicateLoad: true });
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('bridge_protocol_violation');
  expect(result.calls).toEqual([]);
});

test('denies an effect attempted before staging activation', async ({ page }) => {
  const result = await mount(page, await fixture('attack-staging-call.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('capability_denied');
  expect(result.calls).toEqual([]);
});

test('rejects an ungranted state patch before disclosure to the guest', async ({ page }) => {
  const mounted = await mount(page, await fixture('good.mjs'));
  expect(mounted.lifecycle).toBe('active');
  await page.evaluate(() => (
    (window as typeof window & { runtimeHarness: { sendStatePatch: Function } }).runtimeHarness.sendStatePatch({
      base_revision: 1,
      revision: 2,
      mutations: [{ path: 'secret.ungranted', op: 'set', value: 'must-not-cross' }],
    })
  ));
  await expect.poll(async () => (await status(page)).lifecycle).toBe('failed');
  expect((await status(page)).errors[0].code).toBe('capability_denied');
});

test('teardown removes generated UI and requires a fresh epoch', async ({ page }) => {
  await mount(page, await fixture('good.mjs'));
  const first = await status(page);
  await page.evaluate(() => (
    (window as typeof window & { runtimeHarness: { dispose: Function } }).runtimeHarness.dispose()
  ));
  await expect(page.locator('#generated')).toBeEmpty();
  const second = await mount(page, await fixture('good.mjs'));
  expect(second.lifecycle).toBe('active');
  expect(second.epoch).toBeGreaterThan(first.epoch);
  expect(second.renderRevision).toBe(first.renderRevision);
});

test('serializes generation changes across trusted IndexedDB ledgers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = '/release-state.js';
    const {
      ComponentReleaseLedger,
      IndexedDbReleaseMetadataStore,
    } = await import(moduleUrl);
    const databaseName = `release-state-${crypto.randomUUID()}`;
    const homeId = 'home-browser-test';
    const artifactOrigin = 'https://artifacts.example';
    const context = {
      expectedHomeId: homeId,
      allowedArtifactOrigins: new Set([artifactOrigin]),
      allowedPathPrefixes: ['/homes/'],
    };
    const makePointer = (generation: number, sha256: string) => ({
      schema: 'miakapp.component-pointer/1',
      home_id: homeId,
      generation,
      release: `release-${generation}`,
      abi: 'miakapp.component/1',
      url: `${artifactOrigin}/homes/${homeId}/${sha256}.js`,
      sha256,
      size: 128,
      requires: {
        state_read: [],
        event_subscribe: [],
        event_publish: [],
        call: [],
        presentation: [],
      },
    });
    const first = new ComponentReleaseLedger(
      context,
      new IndexedDbReleaseMetadataStore(indexedDB, databaseName),
    );
    const second = new ComponentReleaseLedger(
      context,
      new IndexedDbReleaseMetadataStore(indexedDB, databaseName),
    );
    const digest1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const digest2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const digest3 = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

    await first.accept(makePointer(1, digest1));
    await first.markActive(makePointer(1, digest1));
    const settled = await Promise.allSettled([
      first.accept(makePointer(2, digest2)),
      second.accept(makePointer(2, digest3)),
    ]);
    const stored = await second.read();
    return {
      statuses: settled.map((entry) => entry.status).sort(),
      highest: stored?.highest_accepted.generation,
      acceptedDigest: stored?.highest_accepted.sha256,
      lastKnownGood: stored?.last_known_good?.generation,
    };
  });

  expect(result.statuses).toEqual(['fulfilled', 'rejected'].sort());
  expect(result.highest).toBe(2);
  expect([
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  ]).toContain(result.acceptedDigest);
  expect(result.lastKnownGood).toBe(1);
});
