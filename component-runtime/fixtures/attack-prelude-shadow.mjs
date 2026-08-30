function globalThis() {}

const send = (kind, payload) => self.postMessage({ v: 1, kind, payload });

async function probe() {
  const observations = [
    `fetch:${typeof self.fetch}`,
    `Worker:${typeof self.Worker}`,
    `WebSocket:${typeof self.WebSocket}`,
    `indexedDB:${typeof self.indexedDB}`,
  ];

  if (typeof self.Worker !== 'undefined') {
    const source = "import('http://127.0.0.1:4173/leak-module.mjs?via=hoisted-subworker')";
    const url = self.URL.createObjectURL(new self.Blob([source], { type: 'text/javascript' }));
    try {
      const nested = new self.Worker(url);
      await new Promise((resolve) => setTimeout(resolve, 250));
      nested.terminate();
    } finally {
      self.URL.revokeObjectURL(url);
    }
  }

  send('ui.render', {
    revision: 1,
    tree: {
      id: 'home',
      type: 'screen',
      props: { title: 'Prelude shadow probe' },
      children: [{
        id: 'observations',
        type: 'text',
        props: { text: observations.join('|') },
      }],
    },
  });
}

self.onmessage = (event) => {
  if (event.data.kind === 'state.snapshot') void probe();
};

send('guest.ready', { abi: 'miakapp.component/1' });
