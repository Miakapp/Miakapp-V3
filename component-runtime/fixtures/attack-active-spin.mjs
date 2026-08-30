const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') {
    send('ui.render', {
      revision: 1,
      tree: {
        id: 'home',
        type: 'screen',
        props: { title: 'Active spin' },
        children: [],
      },
    });
  } else if (event.data.kind === 'lifecycle.resume') {
    while (true) {
      // Deliberately stop acknowledging the prelude-owned heartbeat.
    }
  }
};

send('guest.ready', { abi: 'miakapp.component/1' });
