import io from 'socket.io-client';

export default function () {
  /** @type {import('firebase').default.auth.Auth} */
  const auth = window.auth;

  /** @type {import('izitoast').IziToast} */
  const toast = window.toast;

  function toastIt(rs, onClosed = () => null) {
    console.log(rs);
    if (rs.message) toast.success({ title: rs.message, onClosed });
  }

  async function linkToSocket(fUser) {
    if (!fUser) return;
    if (window.socket) window.socket.disconnect();

    /** @type {import('socket.io-client').Socket} */
    window.socket = io('https://miakapi3.cloud.usp-3.fr/', {
      auth: {
        uid: fUser.uid,
        token: fUser.za,
      },
    });

    window.socket.once('logged', (rs) => {
      toastIt(rs);
    });

    window.socket.once('error', (rs) => {
      window.toast.error({ title: rs.message });
    });
  }

  auth.onIdTokenChanged(linkToSocket);

  return {
  };
}
