/*
 * This pass-through worker exists only to retire Miakapp V3 registrations.
 * The V4 host does not register a service worker.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await caches.delete('app');
    await clients.claim();
    await self.registration.unregister();
  })());
});
