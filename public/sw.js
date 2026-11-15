/*
 * Miakapp push worker. FCM delivers two kinds of message:
 * - a device challenge (data only), forwarded to the page that is enabling
 *   notifications so it can prove this device receives pushes;
 * - a notification from a home's agent, shown as is.
 * It also retires the Miakapp V3 cache, and keeps the shell openable without
 * the internet: a page seen before opens from the cache at once and is
 * refreshed in the background for the next opening; hashed assets cache first. With direct mode, a home then opens on the
 * local network with no cloud at all.
 */

const SHELL_CACHE = 'miakapp-shell-v1';
const NAVIGATION_TIMEOUT_MS = 3000;
const MAX_ASSETS = 80;
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await caches.delete('app');
    await clients.claim();
  })());
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const data = message.data || {};
  event.waitUntil((async () => {
    if (data.schema === 'miakapp.push-challenge-delivery/1') {
      // The page may miss a postMessage (iOS): it also polls this cache entry.
      const cache = await caches.open('miakapp-push');
      await cache.put(`/push-challenge/${data.challenge_id}`, new Response(data.challenge_secret));
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({
          type: 'miakapp-push-challenge',
          challenge_id: data.challenge_id,
          challenge_secret: data.challenge_secret,
        });
      }
      await self.registration.showNotification('Miakapp', {
        body: 'Notifications enabled on this device.',
        icon: '/icons/icon-192.png',
        tag: 'miakapp-push-setup',
      });
      return;
    }
    const notification = message.notification || {};
    await self.registration.showNotification(notification.title || 'Miakapp', {
      body: notification.body || '',
      icon: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { home: data.home_id || '' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const home = event.notification.data && event.notification.data.home;
  const url = home ? `/h/${encodeURIComponent(home)}?from=push` : '/';
  event.waitUntil(clients.openWindow(url));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Stores a fresh page, but only once the hashed assets it names are cached
 * too: a page cached without its assets would not open offline.
 */
async function refresh(cache, request, url) {
  const response = await fetch(request);
  if (!response.ok || response.type !== 'basic') return response;
  const html = await response.clone().text();
  const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+/g) || [])];
  const missing = [];
  for (const path of assets) if (!(await cache.match(path))) missing.push(path);
  await cache.addAll(missing);
  await cache.put(url.pathname, response.clone());
  return response;
}

/**
 * A page this device has opened before is drawn at once from the cache, even
 * when the network hangs; the fresh copy is fetched in the background and used
 * at the next opening. A page never seen waits for the network (3 s at most if
 * an older copy of the app can stand in).
 */
async function navigate(event, url) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(url.pathname);
  const network = refresh(cache, event.request, url);
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  try {
    return await withTimeout(network, NAVIGATION_TIMEOUT_MS);
  } catch {
    const fallback = await cache.match('/app') || await cache.match('/');
    if (fallback) return fallback;
    return network;
  }
}

async function asset(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok && response.type === 'basic') {
    event.waitUntil((async () => {
      await cache.put(event.request, response.clone());
      const keys = await cache.keys();
      const assets = keys.filter((request) => new URL(request.url).pathname.startsWith('/assets/'));
      for (const old of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(old);
    })());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, url));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /^\/(icons|brand)\//.test(url.pathname)
    || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico') {
    event.respondWith(asset(event));
  }
});
