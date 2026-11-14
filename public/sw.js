/*
 * Miakapp push worker. FCM delivers two kinds of message:
 * - a device challenge (data only), forwarded to the page that is enabling
 *   notifications so it can prove this device receives pushes;
 * - a notification from a home's agent, shown as is.
 * It also retires the Miakapp V3 cache.
 */
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
  const url = home ? `/app?home=${encodeURIComponent(home)}` : '/';
  event.waitUntil(clients.openWindow(url));
});
