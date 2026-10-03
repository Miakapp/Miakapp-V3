// A hostile house application. Every probe records whether the authority it
// reached for was available; the browser test reads the verdicts and, for
// network probes, also checks the server never heard from it. A classic script,
// as releases are, so the probes run inside an async function.
(async () => {
const results = [];
const record = (name, outcome) => results.push(`${name}=${outcome}`);
const leak = (label) => `http://127.0.0.1:4173/leak?${label}`;

async function probe(name, run) {
  try {
    const outcome = await run();
    record(name, outcome === false ? 'blocked' : 'open');
  } catch {
    record(name, 'blocked');
  }
}

// An overlay that tries to cover everything, including the shell around it.
const cover = document.createElement('div');
cover.id = 'cover';
cover.style.cssText = 'position:fixed;inset:-500px;z-index:2147483647;background:rgba(255,0,0,.4)';
document.body.append(cover);

await probe('fetch', async () => { await fetch(leak('fetch')); });
await probe('dynamicImport', async () => { await import('http://127.0.0.1:4173/leak-module.mjs'); });
await probe('websocket', () => new Promise((resolve, reject) => {
  const socket = new WebSocket('ws://127.0.0.1:4173/leak?ws');
  socket.onopen = () => resolve(true);
  socket.onerror = () => reject(new Error('blocked'));
}));
await probe('image', () => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(true);
  image.onerror = () => reject(new Error('blocked'));
  image.src = leak('img');
}));
await probe('cssImage', async () => {
  const probeNode = document.createElement('div');
  probeNode.style.backgroundImage = `url(${leak('css')})`;
  document.body.append(probeNode);
  getComputedStyle(probeNode).backgroundImage;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return false;
});
await probe('parentDocument', () => Boolean(window.parent.document.body));
await probe('parentStorage', () => window.parent.localStorage.getItem('shell-secret') !== null);
await probe('ownStorage', () => { localStorage.setItem('x', '1'); return true; });
await probe('cookie', () => { document.cookie = 'house=1'; return document.cookie.includes('house'); });
await probe('indexedDB', () => new Promise((resolve, reject) => {
  const request = indexedDB.open('house');
  request.onsuccess = () => resolve(true);
  request.onerror = () => reject(new Error('blocked'));
}));
await probe('popup', () => window.open(leak('popup')) !== null);
await probe('topNavigation', () => { window.top.location.href = leak('top'); return true; });
await probe('fullscreen', async () => { await document.documentElement.requestFullscreen(); });
await probe('ungrantedState', () => window.miakapp.state.get('security.alarm.code') !== undefined);
await probe('ungrantedCall', async () => { await window.miakapp.call('door.unlock', {}); });
await probe('grantedCall', async () => { await window.miakapp.call('lighting.set', { on: true }); });

const output = document.createElement('pre');
output.id = 'results';
output.textContent = results.join('\n');
output.dataset.done = 'true';
output.style.cssText = 'position:relative;z-index:2147483647;background:white';
document.body.append(output);
})();
