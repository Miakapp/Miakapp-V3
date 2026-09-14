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

test('blocks DOM, storage, service-worker, and network authority', async ({ page }) => {
  const leakRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/leak')) leakRequests.push(request.url());
  });
  const result = await mount(page, await fixture('attack-egress.mjs'));
  expect(result.lifecycle).toBe('active');
  await expect(page.getByText(/document:/)).toBeVisible();
  const observations = await page.getByText(/document:/).textContent();
  expect(observations).toContain('document:undefined');
  expect(observations).toContain('window:undefined');
  expect(observations).toContain('parent:undefined');
  expect(observations).toContain('localStorage:undefined');
  for (const name of BLOCKED_WORKER_GLOBALS) {
    expect(observations).toContain(`${name}:undefined`);
  }
  for (const name of BLOCKED_NAVIGATOR_MEMBERS) {
    expect(observations).toContain(`${name}:undefined`);
  }
  for (const attempt of [
    'fetch',
    'xhr',
    'eventSource',
    'sendBeacon',
    'broadcastChannel',
    'importScripts',
    'evalImport',
    'functionImport',
    'websocket',
    'indexedDB',
    'cacheStorage',
  ]) {
    expect(observations).toContain(`${attempt}:blocked`);
  }
  expect(leakRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('firebase-token'))).toBe('firebase-secret-must-not-cross');
});

test('prevents guest declarations from shadowing the confinement prelude', async ({ page }) => {
  const leakRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/leak')) leakRequests.push(request.url());
  });
  const result = await mount(page, await fixture('attack-prelude-shadow.mjs'));
  expect(result.lifecycle, JSON.stringify(result)).toBe('active');
  const observations = await page.getByText(/fetch:/).textContent();
  expect(observations).toContain('fetch:undefined');
  expect(observations).toContain('Worker:undefined');
  expect(observations).toContain('WebSocket:undefined');
  expect(observations).toContain('indexedDB:undefined');
  expect(leakRequests).toEqual([]);
});

test('rejects dynamic import syntax before Worker construction or network', async ({ page }) => {
  const leakRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/leak')) leakRequests.push(request.url());
  });
  const result = await mount(page, await fixture('attack-dynamic-import.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('artifact_program_invalid');
  expect(leakRequests).toEqual([]);
});

test('rejects raw HTML before it reaches the trusted renderer', async ({ page }) => {
  const result = await mount(page, await fixture('attack-invalid-tree.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('render_invalid');
  expect(await page.locator('#generated img').count()).toBe(0);
});

test('denies an undeclared call at the broker and host records no effect', async ({ page }) => {
  const mounted = await mount(page, await fixture('attack-capability.mjs'));
  expect(mounted.lifecycle).toBe('active');
  await page.getByRole('button', { name: 'Try undeclared call' }).click();
  await expect.poll(async () => (await status(page)).lifecycle).toBe('failed');
  const result = await status(page);
  expect(result.errors[0].code).toBe('capability_denied');
  expect(result.calls).toEqual([]);
});

test('denies an effect attempted before staging activation', async ({ page }) => {
  const result = await mount(page, await fixture('attack-staging-call.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('capability_denied');
  expect(result.calls).toEqual([]);
});

test('revokes effectful authority before notifying a suspended guest', async ({ page }) => {
  const mounted = await mount(page, await fixture('attack-suspend-call.mjs'));
  expect(mounted.lifecycle).toBe('active');
  await page.evaluate(() => (
    (window as typeof window & { runtimeHarness: { suspend: Function } }).runtimeHarness.suspend()
  ));
  await expect.poll(async () => (await status(page)).lifecycle).toBe('failed');
  const result = await status(page);
  expect(result.errors[0].code).toBe('capability_denied');
  expect(result.calls).toEqual([]);
});

test('rejects reuse of an operation ID after its terminal result', async ({ page }) => {
  const mounted = await mount(page, await fixture('attack-duplicate-call.mjs'));
  expect(mounted.lifecycle).toBe('active');
  await page.getByRole('button', { name: 'Run duplicate calls' }).click();
  await expect.poll(async () => (await status(page)).lifecycle).toBe('failed');
  const result = await status(page);
  expect(result.errors[0].code).toBe('bridge_protocol_violation');
  expect(result.calls).toHaveLength(1);
});

test('terminates a guest that transfers a MessagePort', async ({ page }) => {
  const result = await mount(page, await fixture('attack-transfer-port.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('bridge_protocol_violation');
  expect(result.logs).toEqual([]);
});

test('terminates an infinite Worker while trusted host tasks keep running', async ({ page }) => {
  const before = (await status(page)).hostTicks;
  const result = await mount(page, await fixture('attack-spin.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('worker_boot_failed');
  expect(result.hostTicks - before).toBeGreaterThan(20);
  await expect(page.getByText('Trusted host ready')).toBeVisible();
});

test('terminates a Worker that becomes unresponsive after activation', async ({ page }) => {
  const mounted = await mount(page, await fixture('attack-active-spin.mjs'));
  expect(mounted.lifecycle).toBe('active');
  const before = (await status(page)).hostTicks;
  await expect.poll(async () => (await status(page)).lifecycle, { timeout: 6_000 }).toBe('failed');
  const result = await status(page);
  expect(result.errors[0].code).toBe('runtime_unresponsive');
  expect(result.hostTicks).toBeGreaterThan(before);
  await expect(page.getByText('Trusted host ready')).toBeVisible();
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

test('terminates a message flood before forwarding an unbounded queue', async ({ page }) => {
  const before = (await status(page)).hostTicks;
  const result = await mount(page, await fixture('attack-flood.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('bridge_protocol_violation');
  expect(result.logs.length).toBeLessThanOrEqual(120);
  expect(result.hostTicks).toBeGreaterThan(before);
});

test('rejects a sparse array before attacker-controlled traversal', async ({ page }) => {
  const result = await mount(page, await fixture('attack-sparse-array.mjs'));
  expect(result.lifecycle).toBe('failed');
  expect(result.errors[0].code).toBe('bridge_protocol_violation');
  expect(result.logs).toEqual([]);
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

test('stages beside the active broker and rolls back without overlapping effect authority', async ({ page }) => {
  const goodSource = await fixture('good.mjs');
  const stagingAttack = await fixture('attack-staging-call.mjs');

  const initialStage = await page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function };
    }).dualRuntimeHarness;
    return dual.stageSource(source, {
      generation: 1,
      release: 'release-1',
      initialState: { 'global.temperature': 21.5 },
    });
  }, { source: goodSource });
  expect(initialStage.activeGeneration).toBeUndefined();
  expect(initialStage.stagedGeneration).toBe(1);
  expect(initialStage.effectfulGenerations).toEqual([]);

  const firstActive = await page.evaluate(async () => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { activateStaged: Function };
    }).dualRuntimeHarness;
    return dual.activateStaged();
  });
  expect(firstActive.activeGeneration).toBe(1);
  expect(firstActive.active.epoch).toBe(1);
  expect(firstActive.effectfulGenerations).toEqual([1]);
  await expect(page.getByText('Temperature: 21.5')).toBeVisible();

  const failedCandidate = await page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function };
    }).dualRuntimeHarness;
    return dual.stageSource(source, {
      generation: 2,
      release: 'release-2-bad',
    });
  }, { source: stagingAttack });
  expect(failedCandidate.activeGeneration).toBe(1);
  expect(failedCandidate.stagedGeneration).toBeUndefined();
  expect(failedCandidate.effectfulGenerations).toEqual([1]);
  expect(failedCandidate.highestAcceptedGeneration).toBe(2);
  await expect(page.getByText('Temperature: 21.5')).toBeVisible();

  const replacementStaged = await page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function };
    }).dualRuntimeHarness;
    return dual.stageSource(source, {
      generation: 3,
      release: 'release-3',
      initialState: { 'global.temperature': 23.5 },
    });
  }, { source: goodSource });
  expect(replacementStaged.activeGeneration).toBe(1);
  expect(replacementStaged.stagedGeneration).toBe(3);
  expect(replacementStaged.effectfulGenerations).toEqual([1]);
  await expect(page.getByText('Temperature: 21.5')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle light' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { status: Function };
    }).dualRuntimeHarness;
    return dual.status().active.calls.length;
  })).toBe(1);

  const replacementActive = await page.evaluate(async () => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { activateStaged: Function };
    }).dualRuntimeHarness;
    return dual.activateStaged();
  });
  expect(replacementActive.activeGeneration).toBe(3);
  expect(replacementActive.active.epoch).toBe(3);
  expect(replacementActive.effectfulGenerations).toEqual([3]);
  await expect(page.getByText('Temperature: 23.5')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle light' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { status: Function };
    }).dualRuntimeHarness;
    return dual.status().active.calls.length;
  })).toBe(1);

  await page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function; activateStaged: Function };
    }).dualRuntimeHarness;
    await dual.stageSource(source, {
      generation: 4,
      release: 'release-4-rollback',
      initialState: { 'global.temperature': 21.5 },
    });
    return dual.activateStaged();
  }, { source: goodSource });

  const rollback = await page.evaluate(() => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { status: Function };
    }).dualRuntimeHarness;
    return dual.status();
  });
  expect(rollback.activeGeneration).toBe(4);
  expect(rollback.active.epoch).toBe(4);
  expect(rollback.highestAcceptedGeneration).toBe(4);
  expect(rollback.effectfulGenerations).toEqual([4]);
  expect(rollback.transitions).toEqual([
    'candidate_staged:1',
    'tree_swapped:1',
    'candidate_effects_enabled:1',
    'candidate_failed:2',
    'candidate_staged:3',
    'old_revoked:1',
    'tree_swapped:3',
    'candidate_effects_enabled:3',
    'candidate_staged:4',
    'old_revoked:3',
    'tree_swapped:4',
    'candidate_effects_enabled:4',
  ]);
  expect(rollback.authoritySamples.every((sample: number[]) => sample.length <= 1)).toBe(true);
  await expect(page.getByText('Temperature: 21.5')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle light' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { status: Function };
    }).dualRuntimeHarness;
    return dual.status().active.calls.length;
  })).toBe(1);

  await expect(page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function };
    }).dualRuntimeHarness;
    return dual.stageSource(source, { generation: 4 });
  }, { source: goodSource })).rejects.toThrow('above the highest accepted generation');

  const concurrent = await page.evaluate(async ({ source }) => {
    const dual = (window as typeof window & {
      dualRuntimeHarness: { stageSource: Function; status: Function; abortStaged: Function };
    }).dualRuntimeHarness;
    const outcomes = await Promise.all([
      dual.stageSource(source, { generation: 5 }).then(
        () => 'staged',
        (error: Error) => error.message,
      ),
      dual.stageSource(source, { generation: 6 }).then(
        () => 'staged',
        (error: Error) => error.message,
      ),
    ]);
    const staged = dual.status();
    dual.abortStaged();
    return { outcomes, staged };
  }, { source: goodSource });
  expect(concurrent.outcomes).toEqual([
    'staged',
    'A component release transition is already in progress',
  ]);
  expect(concurrent.staged.activeGeneration).toBe(4);
  expect(concurrent.staged.stagedGeneration).toBe(5);
  expect(concurrent.staged.highestAcceptedGeneration).toBe(5);
  expect(concurrent.staged.effectfulGenerations).toEqual([4]);
});
