export default function () {
  /** @type {import('firebase').default.auth.Auth} */
  const auth = window.auth;

  /** @type {import('izitoast').IziToast} */
  const toast = window.toast;

  // function toastIt(rs, onClosed = () => null) {
  //   console.log(rs);
  //   if (rs.message) toast.success({ title: rs.message, onClosed });
  // }

  let socket = null;

  function sendPacket(...d) {
    if (socket) socket.send(new Blob(d));
  }

  let fails = 0;

  /** @argument {import('firebase').default.User} fUser */
  async function linkToSocket(fUser) {
    if (!fUser) return;
    if (socket && socket.close) socket.close();

    const url = `wss://miakapi3.cloud.usp-3.fr/${fUser.uid}/${fUser.za}`;

    socket = new WebSocket(url);

    socket.onopen = () => {
      fails = 0;
      toast.success({ title: 'Connected to the server' });
    };

    socket.onerror = () => {};

    socket.onclose = (ev) => {
      setTimeout(() => {
        auth.updateCurrentUser(auth.currentUser);
      }, (!fails ? 0 : 5000));

      fails += 1;
      if (fails === 2 || !(fails % 4)) toast.error({ title: 'Can\'t connect to the server' });

      console.log('CLOSED', ev, ev.code, ev.wasClean);
    };

    socket.onmessage = async (ev) => {
      const packet = await ev.data.text();
      const type = packet[0];
      const data = packet.substring(1);
      console.log('Packet', type, data);

      switch (type) {
        case '\x10': // Ping
          console.log('Ping', data);
          sendPacket('\x20', data);
          break;

        case '\x11': // Data
          console.log('GlobalData', data);
          break;

        default:
          console.log('Unknown packet');
          break;
      }

      if (ev.data === 'ping') {
        socket.send('pong');
      }
    };
  }

  auth.onIdTokenChanged(linkToSocket);

  return {
  };
}
