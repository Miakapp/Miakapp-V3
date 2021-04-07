importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-messaging.js');

self.addEventListener('fetch', (e) => {
  e.respondWith(async function() {
    const normalizedUrl = new URL(e.request.url);
    normalizedUrl.search = '';

    if (
      (
        !normalizedUrl.hostname.includes('miakapp')
        && !normalizedUrl.hostname.includes('fonts')
      )
      || normalizedUrl.pathname.includes('/socket.io')
      || normalizedUrl.protocol === 'chrome-extension:'
    ) {
      console.log(normalizedUrl, 'FETCHING');
      return fetch(e.request);
    } else console.log(normalizedUrl, 'CACHING');

    if (!normalizedUrl.pathname.includes('.')) normalizedUrl.pathname = '';

    const fetchResponseP = fetch(normalizedUrl);
    const fetchResponseCloneP = fetchResponseP.then(r => r.clone());

    e.waitUntil(async function() {
      const cache = await caches.open('app');
      await cache.put(normalizedUrl, await fetchResponseCloneP);
    }());

    return (await caches.match(normalizedUrl)) || fetchResponseP;
  }());
});

self.addEventListener('message', async (e) => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'update') {
    await caches.delete('app');
    return self.skipWaiting();
  }
});

firebase.initializeApp({
  apiKey: 'AIzaSyBn1cfqRZw9UyEbz9fUb4-pbsqSwu5SxAE',
  authDomain: 'miakapp-v2.firebaseapp.com',
  databaseURL: 'https://miakapp-v2.firebaseio.com',
  projectId: 'miakapp-v2',
  storageBucket: 'miakapp-v2.appspot.com',
  messagingSenderId: '639119430041',
  appId: '1:639119430041:web:09bb571a204d077ebd8308',
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler((payload) => {
  return self.registration.showNotification(payload.data.title, {
    body: payload.data.body,
    badge: './icons/notif.png',
    icon: payload.data.icon,
    image: payload.data.image,
    lang: payload.data.lang,
    timestamp: payload.data.timestamp,
    actions: JSON.parse(payload.data.actions ?? '[]'),
    renotify: true,
    tag: payload.data.tag,
    vibrate: [100, 50, 100],
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll().then((clientList) => {
    for (let i = 0; i < clientList.length; i++) {
      const client = clientList[i];
      if (client.url == `./h/${e.notification.tag}` && 'focus' in client) return client.focus();
    }

    if (clients.openWindow) return clients.openWindow(`./h/${e.notification.tag}`);
  }));
});
