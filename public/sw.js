/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-messaging.js');

self.addEventListener('fetch', (e) => {
  e.respondWith((async () => {
    const normalizedUrl = new URL(e.request.url);
    normalizedUrl.search = '';

    if (
      (
        !normalizedUrl.hostname.includes('miakapp.com')
        && !normalizedUrl.hostname.includes('fonts')
      )
      || normalizedUrl.protocol === 'chrome-extension:'
    ) return fetch(e.request);

    const url = (e.request.url === e.request.referrer) ? normalizedUrl.origin : e.request.url;

    console.log('CACHING', url);

    const cached = await caches.match(url);
    if (cached) return cached;

    const fetchResponseP = fetch(e.request);
    const fetchResponseCloneP = fetchResponseP.then((r) => r.clone());

    console.log('DOWNLOAD', url);

    e.waitUntil((async () => {
      const cache = await caches.open('app');
      await cache.put(url, await fetchResponseCloneP);
    })());

    return fetchResponseP;
  })());
});

self.addEventListener('message', async (e) => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'update') {
    await caches.delete('app');
    self.skipWaiting();
  }
});

firebase.initializeApp({
  apiKey: 'AIzaSyBbn5Z7zWn-Qz-JPmNM_YF_rvYvBzvVyec',
  authDomain: 'miakapp-3.firebaseapp.com',
  projectId: 'miakapp-3',
  messagingSenderId: '603250078961',
  appId: '1:603250078961:web:082db2556ca84f0576a550',
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler((payload) => self.registration.showNotification(
  payload.data.title,
  {
    body: payload.data.body,
    badge: './icons/notif.png',
    icon: './icons/128.png',
    image: payload.data.image,
    lang: payload.data.lang,
    timestamp: payload.data.timestamp,
    actions: JSON.parse(payload.data.actions ?? '[]'),
    renotify: true,
    tag: payload.data.tag,
    vibrate: [100, 50, 100],
  },
));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll().then((clientList) => {
    for (let i = 0; i < clientList.length; i += 1) {
      const client = clientList[i];
      if (client.url === `./h/${e.notification.tag}` && 'focus' in client) return client.focus();
    }

    if (clients.openWindow) return clients.openWindow(`./h/${e.notification.tag}`);
    return null;
  }));
});
