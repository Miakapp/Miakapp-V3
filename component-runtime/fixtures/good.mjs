const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

let renderRevision = 0;
let operationState = 'idle';
let temperature = null;

function render() {
  renderRevision += 1;
  send('ui.render', {
    revision: renderRevision,
    tree: {
      id: 'home',
      type: 'screen',
      props: { title: 'Test home' },
      children: [
        {
          id: 'content',
          type: 'stack',
          props: { gap: 'medium' },
          children: [
            {
              id: 'temperature',
              type: 'text',
              props: { text: `Temperature: ${String(temperature)}` },
            },
            {
              id: 'operation',
              type: 'status',
              props: { label: 'Light operation', state: operationState },
            },
            {
              id: 'toggle-light',
              type: 'button',
              props: { label: 'Toggle light', handler: 'toggle-light' },
            },
          ],
        },
      ],
    },
  });
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.kind === 'state.snapshot') {
    temperature = message.payload.values['global.temperature'];
    render();
  } else if (message.kind === 'ui.interaction' && message.payload.handler === 'toggle-light') {
    operationState = 'pending';
    render();
    send('call.start', {
      operation_id: 1,
      name: 'lighting.set',
      args: { enabled: true },
    });
  } else if (message.kind === 'call.accepted') {
    operationState = 'accepted';
    render();
  } else if (message.kind === 'call.result') {
    operationState = 'applied';
    render();
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
