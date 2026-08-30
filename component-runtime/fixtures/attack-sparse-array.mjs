const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind !== 'guest.boot') return;
  const sparse = [];
  sparse.length = 1_000_000;
  send('log.write', sparse);
};

send('guest.ready', { abi: 'miakapp.component/1' });
