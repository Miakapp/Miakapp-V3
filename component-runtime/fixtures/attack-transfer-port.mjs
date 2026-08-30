const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind !== 'state.snapshot') return;
  const channel = new MessageChannel();
  self.postMessage({
    v: 1,
    kind: 'log.write',
    payload: { level: 'info', message: 'smuggled port' },
  }, [channel.port1]);
};

send('guest.ready', { abi: 'miakapp.component/1' });
