const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') {
    send('ui.render', {
      revision: 1,
      tree: {
        id: 'home',
        type: 'screen',
        props: { title: 'Capability probe' },
        children: [{
          id: 'unlock',
          type: 'button',
          props: { label: 'Try undeclared call', handler: 'unlock' },
        }],
      },
    });
  } else if (event.data.kind === 'ui.interaction') {
    send('call.start', {
      operation_id: 1,
      name: 'door.unlock',
      args: {},
    });
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
