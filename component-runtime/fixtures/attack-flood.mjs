const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind !== 'guest.boot') return;
  for (let index = 0; index < 2_000; index += 1) {
    send('log.write', { level: 'info', message: `flood-${index}` });
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
