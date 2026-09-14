import { expect, test } from '@playwright/test';

// Workstream D exit gate: "a deliberately hostile bundle is contained by
// browser-enforced boundaries, not by instructions or conventions."
//
// `runtime.spec.ts` proves the deployed runtime denies authority, but it always
// runs both layers at once: the confinement prelude that deletes globals, and
// the browser boundary (opaque origin plus the sandbox document CSP). A green
// result there is compatible with the prelude doing all of the work, which is
// exactly the "convention" the gate rules out.
//
// This file removes the prelude and keeps the browser conditions identical, so
// the remaining denials are attributable to the browser alone.

const boundaryUrl = 'http://localhost:4173/boundary.html';
const hostUrl = 'http://127.0.0.1:4173/host.html';

// Every authority the prelude removes, plus the host-storage and service-worker
// reach named by roadmap deliverable D.6.
const PROBES = [
  'fetch',
  'xhr',
  'eventSource',
  'sendBeacon',
  'importScripts',
  'dynamicImport',
  'websocket',
  'indexedDB',
  'cacheStorage',
  'broadcastChannelReach',
  'subworker',
  'hostStorage',
  'serviceWorker',
] as const;

async function readObservations(page: import('@playwright/test').Page): Promise<Map<string, string>> {
  const node = page.locator('#observations[data-done="true"]');
  await expect(node).toBeAttached({ timeout: 15_000 });
  const text = (await node.textContent()) ?? '';
  expect(text, 'probe failed before reporting').not.toContain('worker-error:');

  const observations = new Map<string, string>();
  for (const entry of text.split('|')) {
    const [label, ...rest] = entry.split(':');
    observations.set(label!, rest.join(':'));
  }
  return observations;
}

test('the browser alone contains a hostile guest without the confinement prelude', async ({ context }) => {
  const leakRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/leak')) leakRequests.push(request.url());
  });

  // A cooperating peer on the trusted host origin. It echoes whatever it hears,
  // so the guest learns of any reach, and it records what it heard, so the
  // assertion does not depend on the guest telling the truth.
  const hostPeer = await context.newPage();
  await hostPeer.goto(hostUrl);
  await hostPeer.evaluate(() => {
    const scope = window as typeof window & { heardFromGuest: string[] };
    scope.heardFromGuest = [];
    const channel = new BroadcastChannel('cross-home-probe');
    channel.onmessage = (event) => {
      scope.heardFromGuest.push(String(event.data));
      channel.postMessage('echo');
    };
  });

  const page = await context.newPage();
  await page.goto(boundaryUrl);
  const observations = await readObservations(page);

  // Recorded so a regression names the authority that opened, and so the
  // per-engine cause (missing global versus refused call) stays visible.
  const available: string[] = [];
  for (const probe of PROBES) {
    const outcome = observations.get(probe);
    expect(outcome, `probe ${probe} did not report`).toBeDefined();
    if (outcome!.startsWith('available')) available.push(probe);
  }

  expect(
    available,
    `authority reachable with the prelude removed: ${available.join(', ')}. `
      + 'These are contained by our JavaScript only, so the exit gate is not met for them.',
  ).toEqual([]);

  // Independent of what the guest believed happened: nothing reached the network.
  expect(leakRequests, 'hostile guest performed network egress').toEqual([]);

  // Direct evidence from the other side of the boundary.
  const heard = await hostPeer.evaluate(() => (
    (window as typeof window & { heardFromGuest: string[] }).heardFromGuest
  ));
  expect(heard, 'guest reached the trusted host origin over BroadcastChannel').toEqual([]);
});

test('the host secret survives a guest running without the confinement prelude', async ({ page }) => {
  await page.goto(boundaryUrl);
  await readObservations(page);

  // Read on the trusted host origin, not the sandbox origin: proves the secret
  // is still exactly what the host stored rather than merely unreadable here.
  await page.goto('http://127.0.0.1:4173/host.html');
  const secret = await page.evaluate(() => localStorage.getItem('firebase-token'));
  expect(secret).toBe('firebase-secret-must-not-cross');
});
