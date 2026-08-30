const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

self.onmessage = (event) => {
  if (event.data.kind !== 'state.snapshot') return;
  send('ui.render', {
    revision: 1,
    tree: {
      id: 'home',
      type: 'screen',
      props: { title: 'Hostile tree' },
      children: [{
        id: 'payload',
        type: 'text',
        props: {
          text: 'Looks harmless',
          html: '<img src="http://127.0.0.1:4173/leak?via=html">',
        },
      }],
    },
  });
};

send('guest.ready', { abi: 'miakapp.component/1' });
