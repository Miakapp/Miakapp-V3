import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const hostUrl = 'http://127.0.0.1:4173/host.html';

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

test.beforeEach(async ({ page }) => {
  await page.goto(hostUrl);
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
