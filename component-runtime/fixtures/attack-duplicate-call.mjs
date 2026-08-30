const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') {
    send('ui.render', {
      revision: 1,
      tree: {
        id: 'home',
        type: 'screen',
        props: { title: 'Duplicate call probe' },
        children: [{
          id: 'run',
          type: 'button',
          props: { label: 'Run duplicate calls', handler: 'run' },
        }],
      },
    });
  } else if (event.data.kind === 'ui.interaction') {
    send('call.start', {
      operation_id: 7,
      name: 'lighting.set',
      args: { enabled: true },
    });
  } else if (event.data.kind === 'call.result') {
    send('call.start', {
      operation_id: 7,
      name: 'lighting.set',
      args: { enabled: false },
    });
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
