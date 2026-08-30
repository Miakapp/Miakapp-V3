const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind !== 'guest.boot') return;
  send('call.start', {
    operation_id: 1,
    name: 'lighting.set',
    args: { enabled: true },
  });
};

send('guest.ready', { abi: 'miakapp.component/1' });
