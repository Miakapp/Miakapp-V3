import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

// The `miakapp.app/1` boundary, observed in a real browser.
//
// A house application owns a whole document: its own layout, styles, routing
// and libraries. These tests hold the shell to what that freedom must not buy:
// reach into the shell, its storage or the network; a way to cover the Miakapp
// controls; fullscreen; navigation away from the verified release; and a crash
// or hang that takes the shell down with it.

const hostUrl = 'http://127.0.0.1:4173/app-host.html';

// Desktop Chrome runs a cross-site frame in its own process; Playwright's
// headless shell does not unless asked. Without that, a spinning house blocks
// the shell's own thread and nothing in the page can recover it — a browser
// property recorded as a limitation, not something this code can fix.
test.use({ launchOptions: { args: ['--site-per-process'] } });

async function fixture(name: string): Promise<string> {
  return await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

async function open(page: Page): Promise<void> {
  await page.goto(hostUrl);
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await page.request.get('http://127.0.0.1:4173/leak-reset');
}

async function mount(page: Page, name: string, request: Record<string, unknown> = {}): Promise<void> {
  const source = await fixture(name);
  await page.evaluate(async ({ source: text, request: options }) => {
    const scope = window as unknown as { house: { mount(source: string, request: unknown): Promise<void> } };
    await scope.house.mount(text, options);
  }, { source, request });
}

async function events(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as unknown as { house: { events: string[] } }).house.events.slice());
}

async function leakHits(page: Page): Promise<string[]> {
  const response = await page.request.get('http://127.0.0.1:4173/leak-hits');
  return await response.json() as string[];
}

test.beforeEach(({ browserName }) => {
  // The corpus pins Chromium behaviour; Firefox and WebKit run the semantic
  // runtime corpus but are not installed for the house-app frame here.
  test.skip(browserName !== 'chromium', 'house-app corpus runs on Chromium');
});

test('a house draws its own interface and drives the home only through granted calls', async ({ page }) => {
  await open(page);
  await mount(page, 'house-app.mjs');
  await expect.poll(() => events(page)).toEqual(['starting', 'loading', 'active']);

  const frameElement = page.locator('iframe.house-app-frame');
  await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  await expect(frameElement).not.toHaveAttribute('allowfullscreen', /.*/u);
  await expect(frameElement).toHaveAttribute('title', 'Interface de Maison test');

  const house = page.frameLocator('iframe.house-app-frame');
  await expect(house.locator('#living')).toHaveText('Salon 21.5 °C');
  // Its own styles apply inside its own document.
  await expect(house.locator('.room')).toHaveCSS('border-radius', '20px');
  // A state path outside the grant never crossed the port.
  await expect(house.locator('#ungranted')).toHaveText('undefined');

  // Its own navigation.
  await house.getByRole('link', { name: 'Lumières' }).click();
  await expect(house.locator('#light-status')).toHaveText('Éteint');
  await house.locator('#light').click();
  await expect(house.locator('#light-status')).toHaveText('Allumé');

  const calls = await page.evaluate(() => (window as unknown as { house: { calls: unknown[] } }).house.calls);
  expect(calls).toEqual([{ name: 'lighting.set', args: { on: true } }]);

  // A stale home is said to be stale, not shown as current.
  await page.evaluate(() => (window as unknown as { house: { markStale(): void } }).house.markStale());
  await expect(house.locator('#light-status')).toHaveText('Données anciennes');
  await expect(house.locator('#light')).toBeDisabled();
});

test('a house built with a UI framework runs as one bundled release', async ({ page }) => {
  await open(page);
  const source = await (await page.request.get('http://127.0.0.1:4173/fixtures/house-react.js')).text();
  await page.evaluate(async (text) => {
    const scope = window as unknown as { house: { mount(source: string, request: unknown): Promise<void> } };
    await scope.house.mount(text, {});
  }, source);
  await expect.poll(() => events(page)).toEqual(['starting', 'loading', 'active']);

  const house = page.frameLocator('iframe.house-app-frame');
  await expect(house.locator('#react-title')).toHaveText('Maison test');
  await expect(house.locator('#lamp')).toHaveText('Lumière éteinte');
  await house.locator('#lamp').click();
  await expect(house.locator('#lamp')).toHaveText('Lumière allumée');
  await expect(house.locator('#lamp')).toHaveCSS('background-color', 'rgb(255, 211, 77)');
});

test('a hostile house reaches no network, storage, shell, popup or fullscreen, and cannot cover the shell', async ({ page }) => {
  await open(page);
  await mount(page, 'house-attack.mjs');
  const house = page.frameLocator('iframe.house-app-frame');
  const results = house.locator('#results[data-done="true"]');
  await expect(results).toBeAttached({ timeout: 15_000 });
  const verdicts = Object.fromEntries(((await results.textContent()) ?? '')
    .split('\n')
    .map((line) => line.split('=') as [string, string]));

  expect(verdicts).toEqual({
    fetch: 'blocked',
    dynamicImport: 'blocked',
    websocket: 'blocked',
    image: 'blocked',
    cssImage: 'blocked',
    parentDocument: 'blocked',
    parentStorage: 'blocked',
    ownStorage: 'blocked',
    cookie: 'blocked',
    indexedDB: 'blocked',
    popup: 'blocked',
    topNavigation: 'blocked',
    fullscreen: 'blocked',
    ungrantedState: 'blocked',
    ungrantedCall: 'blocked',
    grantedCall: 'open',
  });

  // Nothing left the browser, whatever the in-frame verdicts claimed.
  expect(await leakHits(page)).toEqual([]);
  // The shell page is where it was, and nothing escaped into fullscreen.
  expect(page.url()).toBe(hostUrl);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

  // The house painted a maximal fixed overlay; the shell control outside the
  // frame is still the element under the pointer and still answers.
  await page.locator('#shell-menu').click();
  await expect(page.locator('#shell-menu')).toHaveAttribute('data-presses', '1');
  const box = await page.locator('iframe.house-app-frame').boundingBox();
  const bar = await page.locator('#shell-bar').boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
});

test('a house that fails while booting is replaced by the shell, which keeps working', async ({ page }) => {
  await open(page);
  await mount(page, 'house-crash.mjs');
  await expect.poll(() => events(page)).toEqual(['starting', 'loading', 'crashed:boot_error']);
  await expect(page.locator('iframe.house-app-frame')).toHaveCount(0);
  await page.locator('#shell-menu').click();
  await expect(page.locator('#shell-menu')).toHaveAttribute('data-presses', '1');
});

test('a house that hangs is detected and removed while the shell stays responsive', async ({ page }) => {
  await open(page);
  await mount(page, 'house-spin.mjs', { heartbeatMs: 300 });
  await expect.poll(() => events(page)).toContain('active');

  // The shell answers while the house spins.
  await page.waitForTimeout(400);
  await page.locator('#shell-menu').click();
  await expect(page.locator('#shell-menu')).toHaveAttribute('data-presses', '1');

  await expect.poll(() => events(page), { timeout: 10_000 }).toContain('crashed:unresponsive');
  await expect(page.locator('iframe.house-app-frame')).toHaveCount(0);
});

test('a house cannot replace itself with an unverified page or carry state out by navigating', async ({ page }) => {
  await open(page);
  await mount(page, 'house-navigate.mjs');
  await expect.poll(() => events(page), { timeout: 10_000 }).toContain('crashed:navigated');
  await expect(page.locator('iframe.house-app-frame')).toHaveCount(0);
  expect(await leakHits(page)).toEqual([]);
});

test('the keyboard way back to the Miakapp menu works from inside the house', async ({ page }) => {
  await open(page);
  await mount(page, 'house-app.mjs');
  await expect.poll(() => events(page)).toContain('active');
  const house = page.frameLocator('iframe.house-app-frame');
  await house.getByRole('link', { name: 'Pièces' }).focus();
  await page.keyboard.press('Alt+Shift+KeyM');
  await expect(page.locator('#shell-menu')).toBeFocused();
});
