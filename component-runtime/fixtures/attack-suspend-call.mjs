const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') {
    send('ui.render', {
      revision: 1,
      tree: {
        id: 'home',
        type: 'screen',
        props: { title: 'Suspend probe' },
        children: [],
      },
    });
  } else if (event.data.kind === 'lifecycle.suspend') {
    send('call.start', {
      operation_id: 1,
      name: 'lighting.set',
      args: { enabled: true },
    });
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
